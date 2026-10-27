import { AnimatePresence, motion, MotionConfig } from 'motion/react'
import { type ComponentType, useEffect, useMemo, useState } from 'react'

import type { Filters, Site } from '../shared/types'
import { createApiClient, type Fetcher } from './api'
import { BrandMark } from './brand'
import { DashboardProvider, requestKey } from './context'
import { useResource } from './data'
import { Icon } from './icons'
import { AddSiteDialog, CreateSiteForm, LoginForm } from './Login'
import { type DateRange, presetRange } from './range'
import { FilterBar, IntervalPicker, RangePicker } from './Toolbar'
import { SiteTile, Status } from './ui'
import { LayerContext } from './ui/layer'
import { Select } from './ui/select'
import { Switch } from './ui/switch'
import { Tooltip } from './ui/tooltip'
import { Events } from './views/Events'
import { Funnels } from './views/Funnels'
import { Pages, Sources } from './views/Lists'
import { Overview } from './views/Overview'
import { Realtime } from './views/Realtime'
import { Revenue } from './views/Revenue'
import { Sessions } from './views/Sessions'
import { Settings } from './views/Settings'
import { SitesOverview } from './views/Sites'

export type DashboardView =
  'sites' | 'overview' | 'sources' | 'pages' | 'events' | 'funnels' | 'revenue' | 'sessions' | 'realtime' | 'settings'

type SiteView = Exclude<DashboardView, 'sites'>

const VIEWS: Record<SiteView, { label: string; component: ComponentType; ranged: boolean }> = {
  overview: { label: 'Overview', component: Overview, ranged: true },
  sources: { label: 'Sources', component: Sources, ranged: true },
  pages: { label: 'Pages', component: Pages, ranged: true },
  events: { label: 'Events', component: Events, ranged: true },
  funnels: { label: 'Funnels', component: Funnels, ranged: true },
  revenue: { label: 'Revenue', component: Revenue, ranged: true },
  sessions: { label: 'Sessions', component: Sessions, ranged: true },
  realtime: { label: 'Realtime', component: Realtime, ranged: false },
  settings: { label: 'Settings', component: Settings, ranged: false },
}

const NAV: { value: DashboardView; label: string }[] = [
  { value: 'sites', label: 'Websites' },
  ...(Object.keys(VIEWS) as SiteView[]).map((value) => ({ value, label: VIEWS[value].label })),
]

export interface DashboardProps {
  /** Base URL of the analytik API, e.g. `/api`. */
  api: string
  /** Site shown first. Default: the first site. */
  siteId?: string
  /** Replaces `fetch`, e.g. to add headers. Requests use `credentials: 'include'`. */
  fetcher?: Fetcher
  /** Forces a theme; by default it follows `prefers-color-scheme`. */
  theme?: 'light' | 'dark'
  /** View shown first. Default `overview`. */
  view?: DashboardView
}

const NEW_SITE = '\u0000new'
const LIVE_MS = 30000

/** The same preset ending now, keeping the chosen interval; custom ranges stay as they are. */
const renew = (range: DateRange): DateRange =>
  range.preset === 'custom' ? range : { ...presetRange(range.preset, Date.now()), interval: range.interval }

/** The full dashboard: login, sites overview, site switcher, date range, filters and every view. */
export function Dashboard({ api, siteId, fetcher, theme, view: initialView = 'overview' }: DashboardProps) {
  const [unauthorized, setUnauthorized] = useState(false)
  const [chosenId, setChosenId] = useState(siteId)
  const [view, setView] = useState<DashboardView>(initialView)
  const [range, setRange] = useState(() => presetRange('7d', Date.now()))
  const [filters, setFilters] = useState<Filters>({})
  const [adding, setAdding] = useState(false)
  const [live, setLive] = useState(false)
  // Bumped by "Refresh" on a custom range, which has no newer data window to move to; remounts the view.
  const [generation, setGeneration] = useState(0)
  // Popups portal into the root so they inherit its theme variables.
  const [root, setRoot] = useState<HTMLDivElement | null>(null)

  const client = useMemo(() => {
    const base = fetcher ?? ((input: string, init?: RequestInit) => fetch(input, init))
    return createApiClient(api, async (input, init) => {
      const response = await base(input, init)
      if (response.status === 401 && !input.endsWith('/auth/login')) setUnauthorized(true)
      return response
    })
  }, [api, fetcher])
  const apiUrl = useMemo(() => new URL(api, location.href).href.replace(/\/+$/, ''), [api])
  const sites = useResource<Site[]>(requestKey('sites', api, unauthorized), () =>
    unauthorized ? Promise.resolve([]) : client.sites(),
  )

  const liveOn = live && range.preset !== 'custom'
  useEffect(() => {
    if (!liveOn) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') setRange(renew)
    }, LIVE_MS)
    return () => clearInterval(timer)
  }, [liveOn])

  const list = sites.data ?? []
  const site = list.find((s) => s.id === chosenId) ?? list[0]
  const current = view === 'sites' ? undefined : VIEWS[view]

  const addFilter = (dimension: string, value: string): void => {
    setFilters((f) => ({ ...f, [dimension]: value }))
    if (!current?.ranged) setView('overview')
  }
  const openSite = (id: string): void => {
    setChosenId(id)
    setFilters({})
  }
  const refresh = (): void => {
    if (range.preset === 'custom') setGeneration((g) => g + 1)
    else setRange(renew(range))
  }
  const created = (next: Site): void => {
    setAdding(false)
    setChosenId(next.id)
    setView('settings')
    sites.reload()
  }

  let main
  if (unauthorized) {
    main = <LoginForm client={client} onLogin={() => setUnauthorized(false)} />
  } else if (sites.loading || sites.error) {
    main = <Status loading={sites.loading} error={sites.error} />
  } else if (!site) {
    main = <CreateSiteForm client={client} onCreated={created} />
  } else if (!current) {
    main = (
      <SitesOverview
        client={client}
        sites={list}
        onOpen={(s) => {
          openSite(s.id)
          setView('overview')
        }}
        onAdd={() => setAdding(true)}
      />
    )
  } else {
    const View = current.component
    main = (
      <DashboardProvider
        client={client}
        apiUrl={apiUrl}
        site={site}
        range={range}
        filters={filters}
        onFilter={addFilter}
        onSiteChange={sites.reload}
        onViewChange={setView}
      >
        <div className="analytik-toolbar">
          <h1 className="analytik-sr-only">{current.label}</h1>
          <Select
            label="Site"
            hideLabel
            className="analytik-pill analytik-switcher"
            leading={<SiteTile site={site} />}
            value={site.id}
            options={[...list.map((s) => ({ value: s.id, label: s.name })), { value: NEW_SITE, label: 'Add website…' }]}
            onChange={(id) => {
              if (id === NEW_SITE) setAdding(true)
              else openSite(id)
            }}
          />
          {current.ranged && (
            <>
              <RangePicker range={range} onChange={setRange} />
              <IntervalPicker range={range} onChange={setRange} />
              <Switch
                className="analytik-pill analytik-live-toggle"
                checked={liveOn}
                disabled={range.preset === 'custom'}
                onChange={setLive}
              >
                <span className="analytik-live-dot" data-idle={liveOn ? undefined : ''} aria-hidden="true" />
                Live
              </Switch>
              <Tooltip label="Refresh">
                <button
                  type="button"
                  className="analytik-pill-icon analytik-pill"
                  aria-label="Refresh"
                  onClick={refresh}
                >
                  <Icon name="refresh" />
                </button>
              </Tooltip>
            </>
          )}
        </div>
        {current.ranged && <FilterBar filters={filters} onChange={setFilters} />}
        <AnimatePresence mode="wait">
          <View key={`${view}-${site.id}-${generation}`} />
        </AnimatePresence>
      </DashboardProvider>
    )
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="analytik" data-theme={theme} ref={setRoot}>
        <LayerContext value={root}>
          {!unauthorized && site && (
            <header className="analytik-header">
              <span className="analytik-brand">
                <BrandMark />
                analytik
              </span>
              <nav aria-label="Dashboard">
                <ul>
                  {NAV.map(({ value, label }) => (
                    <li key={value}>
                      <button
                        type="button"
                        className="analytik-nav-item"
                        aria-current={value === view ? 'page' : undefined}
                        onClick={() => setView(value)}
                      >
                        {value === view && (
                          <motion.span className="analytik-nav-pill" layoutId="analytik-nav-pill" aria-hidden="true" />
                        )}
                        <span>{label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>
              <button
                type="button"
                className="analytik-button analytik-signout"
                onClick={() => void client.logout().finally(() => setUnauthorized(true))}
              >
                Log out
              </button>
            </header>
          )}
          {/* Not a <main>: the dashboard is embedded in pages that have their own. */}
          <div className="analytik-main">{main}</div>
          {!unauthorized && (
            <AddSiteDialog client={client} open={adding} onCreated={created} onClose={() => setAdding(false)} />
          )}
        </LayerContext>
      </div>
    </MotionConfig>
  )
}
