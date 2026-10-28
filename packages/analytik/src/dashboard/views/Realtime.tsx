import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import type { Realtime as RealtimeData, RealtimeVisit } from '../../shared/types'
import { requestKey, useDashboard } from '../context'
import { CopyId, pageUrl } from '../copy-id'
import { liveSignature, usePolling, useResource } from '../data'
import { countryName, formatAgo, formatNumber } from '../format'
import { t } from '../i18n'
import { Icon } from '../icons'
import { groupPlaces, type MapPlace, WorldMap } from '../map'
import { SiteTile, Status } from '../ui'
import { LayerContext } from '../ui/layer'
import { AnimatedNumber, EASE, View } from '../ui/motion'
import { Tooltip } from '../ui/tooltip'
import { Browser, Visitor } from './cells'
import { SessionDialog } from './Sessions'

// Each poll is a billed request on serverless hosts; ten seconds still feels live, and a quiet site is asked at most
// once a minute.
const REFRESH_MS = 10_000
const QUIET_REFRESH_MS = 60_000
const FEED_LENGTH = 6

type RecentEvent = RealtimeData['recent'][number]

/** One feed line: who, what they did and on what. */
export function describeEvent(event: RecentEvent): { who: string; action: string; target: string } {
  const who = event.country ? t('Visitor from {country}', { country: countryName(event.country) }) : t('A visitor')
  const target = (event.type === 'revenue' ? event.path : (event.name ?? event.path)) ?? ''
  const action = {
    pageview: t('visited'),
    goal: t('completed'),
    revenue: t('paid on'),
    outbound: t('left for'),
    ping: t('is reading'),
    identify: t('signed in on'),
  }[event.type]
  return { who, action, target }
}

let audio: AudioContext | undefined

/** A short quiet tone for a new visit. The context is created on the click that turns sound on. */
function ping(): void {
  if (!audio) return
  const tone = audio.createOscillator()
  const gain = audio.createGain()
  tone.frequency.value = 880
  gain.gain.setValueAtTime(0.06, audio.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.25)
  tone.connect(gain).connect(audio.destination)
  tone.start()
  tone.stop(audio.currentTime + 0.25)
}

function IconButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string
  pressed?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        className="analytik-icon-button"
        aria-label={label}
        aria-pressed={pressed}
        onClick={onClick}
      >
        {children}
      </button>
    </Tooltip>
  )
}

/** An on/off view choice remembered in this browser, e.g. the globe view. */
function useStoredFlag(name: string): [boolean, (on: boolean) => void] {
  const key = `analytik:realtime-${name}`
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(key) === '1'
    } catch {
      return false
    }
  })
  const set = (next: boolean): void => {
    setOn(next)
    try {
      localStorage.setItem(key, next ? '1' : '0')
    } catch {
      // Without storage the choice lasts until the view closes.
    }
  }
  return [on, set]
}

/** Stable keys for feed lines, so a new event slides in on top instead of every line re-rendering. */
export function feedKeys(events: readonly RecentEvent[]): string[] {
  const seen = new Map<string, number>()
  return events.map((e) => {
    const base = `${e.ts}-${e.type}-${e.name ?? ''}-${e.path ?? ''}`
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return count ? `${base}-${count}` : base
  })
}

/** The visitors at one place on the map: where they are on the site, where they came from, and since when. */
function PlaceCard({
  place,
  now,
  onOpen,
  onClose,
}: {
  place: MapPlace
  now: number
  onOpen: (visit: RealtimeVisit) => void
  onClose: () => void
}) {
  return (
    <motion.div
      className="analytik-float analytik-place-card"
      role="region"
      aria-label={t('Visitors in {place}', { place: place.label })}
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12, transition: { duration: 0.15 } }}
      transition={{ duration: 0.25, ease: EASE }}
      onKeyDown={(event) => event.key === 'Escape' && onClose()}
    >
      <div className="analytik-place-head">
        <div>
          <h3>{place.label}</h3>
          <p className="analytik-muted">
            {t('{count, plural, one {# visitor} other {# visitors}} right now', { count: place.count })}
          </p>
        </div>
        <IconButton label={t('Close details')} onClick={onClose}>
          <Icon name="close" />
        </IconButton>
      </div>
      <ul className="analytik-place-list">
        {place.visits.map((visit) => (
          <li key={visit.sessionId}>
            <button
              type="button"
              className="analytik-place-visit"
              onClick={() => onOpen(visit)}
              aria-label={t('Open the visit of {visitor}', { visitor: visit.visitorId.slice(-6) })}
            >
              <Visitor id={visit.visitorId} />
              <span className="analytik-place-page analytik-mono">{visit.page ?? '—'}</span>
              <span className="analytik-place-meta">
                <span>{visit.source}</span>
                <Browser browser={visit.browser} />
                <span className="analytik-muted">{t('arrived {time}', { time: formatAgo(visit.startedAt, now) })}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </motion.div>
  )
}

/** Who is on the site right now: a map of their locations, the live count and a feed of what they do. */
export function Realtime() {
  const { client, site, openView } = useDashboard()
  const live = useResource<RealtimeData>(requestKey('realtime', site.id), () => client.realtime(site.id))
  const [now, setNow] = useState(() => Date.now())
  const [globe, setGlobe] = useStoredFlag('globe')
  const [sound, setSound] = useState(false)
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const [placeKey, setPlaceKey] = useState<string | null>(null)
  const [session, setSession] = useState<string | null>(null)
  const seen = useRef(0)
  const { reload } = live
  const data = live.data
  const latest = data?.recent[0]?.ts ?? 0
  const feed = data?.recent.slice(0, FEED_LENGTH) ?? []
  const keys = feedKeys(feed)
  // The chosen place, refreshed with the data; it closes once nobody is there.
  const place = data && placeKey ? groupPlaces(data.locations).find((p) => p.key === placeKey) : undefined

  usePolling(
    () => {
      setNow(Date.now())
      reload()
    },
    liveSignature(data),
    REFRESH_MS,
    QUIET_REFRESH_MS,
  )

  useEffect(() => {
    if (sound && seen.current && latest > seen.current) ping()
    seen.current = Math.max(seen.current, latest)
  }, [latest, sound])

  const toggleSound = (): void => {
    if (!sound && typeof AudioContext === 'function') audio ??= new AudioContext()
    setSound(!sound)
  }
  const toggleFullscreen = (): void => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void root?.requestFullscreen()
  }

  return (
    <View>
      <Status loading={live.loading && !data} error={live.error}>
        {data && (
          <section className="analytik-realtime" aria-label={t('Real-time visitors')} ref={setRoot}>
            <LayerContext value={root}>
              <WorldMap
                locations={data.locations}
                globe={globe}
                selected={place?.key}
                onSelect={(key) => setPlaceKey(key === placeKey ? null : key)}
              />
              <AnimatePresence>
                {place && (
                  <PlaceCard
                    key={place.key}
                    place={place}
                    now={now}
                    onOpen={(visit) => setSession(visit.sessionId)}
                    onClose={() => setPlaceKey(null)}
                  />
                )}
              </AnimatePresence>
              <SessionDialog sessionId={session} onClose={() => setSession(null)} />
              <div className="analytik-float analytik-live-card">
                <div className="analytik-live-head">
                  <SiteTile site={site} />
                  <div>
                    <h2>{site.name}</h2>
                    <p className="analytik-eyebrow">{t('Real-time')}</p>
                  </div>
                  <div className="analytik-icon-row">
                    <IconButton label={t('Sound on new visits')} pressed={sound} onClick={toggleSound}>
                      <Icon name={sound ? 'sound' : 'muted'} />
                    </IconButton>
                    <IconButton label={t('Globe view')} pressed={globe} onClick={() => setGlobe(!globe)}>
                      <Icon name={globe ? 'globe' : 'flat'} />
                    </IconButton>
                    {document.fullscreenEnabled && (
                      <IconButton label={t('Full screen')} onClick={toggleFullscreen}>
                        <Icon name="expand" />
                      </IconButton>
                    )}
                    {openView && (
                      <IconButton label={t('Close real-time view')} onClick={() => openView('overview')}>
                        <Icon name="close" />
                      </IconButton>
                    )}
                  </div>
                </div>
                <p className="analytik-live-count">
                  <span className="analytik-live-dot" aria-hidden="true" />
                  <strong className="analytik-stat-value">
                    <AnimatedNumber value={data.online} format={formatNumber} />
                  </strong>{' '}
                  {t('{count, plural, one {visitor} other {visitors}} on {domain}', {
                    count: data.online,
                    domain: site.domain,
                  })}
                </p>
              </div>
              <div className="analytik-float analytik-feed">
                <h3 className="analytik-eyebrow">{t('Recent activity')}</h3>
                {data.recent.length ? (
                  <ol className="analytik-timeline" aria-live="polite">
                    <AnimatePresence initial={false} mode="popLayout">
                      {feed.map((e, i) => {
                        const { who, action, target } = describeEvent(e)
                        const url = e.type === 'goal' ? null : pageUrl(site.domain, target)
                        return (
                          <motion.li
                            key={keys[i]}
                            layout
                            data-type={e.type}
                            initial={{ opacity: 0, y: -14 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, transition: { duration: 0.2 } }}
                            transition={{ duration: 0.35, ease: EASE }}
                          >
                            <span>
                              {who} {action} <strong>{target || '—'}</strong>
                              {url && (
                                <span className="analytik-cell-actions">
                                  <CopyId text={url} label={t('Copy URL')} />
                                </span>
                              )}
                            </span>
                            <span className="analytik-muted">{formatAgo(e.ts, now)}</span>
                          </motion.li>
                        )
                      })}
                    </AnimatePresence>
                  </ol>
                ) : (
                  <p className="analytik-empty">{t('Nobody here right now')}</p>
                )}
              </div>
            </LayerContext>
          </section>
        )}
      </Status>
    </View>
  )
}
