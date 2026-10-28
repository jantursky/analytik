import { AnimatePresence, motion, MotionConfig } from 'motion/react'
import { type ComponentType, useEffect, useMemo, useRef, useState } from 'react'

import type { Filters, Site } from '../shared/types'
import { createApiClient, type Fetcher } from './api'
import { BrandMark } from './brand'
import { DashboardProvider, requestKey } from './context'
import { Credits } from './credits'
import { useResource } from './data'
import { Icon } from './icons'
import { AddSiteDialog, CreateSiteForm, LoginForm } from './Login'
import { parseTheme, PreferencesProvider, usePreferencesStore } from './preferences'
import { type DateRange, presetRange } from './range'
import { ThemeToggle } from './theme-toggle'
import { FilterBar, IntervalPicker, RangePicker } from './Toolbar'
import { ConfirmButton, FaviconsContext, type FaviconSource, SiteTile, Status } from './ui'
import { LayerContext } from './ui/layer'
import { Select } from './ui/select'
import { Switch } from './ui/switch'
import { Tooltip } from './ui/tooltip'
import { UpdateNotice } from './update-notice'
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
  sources: { label: 'Acquisition', component: Sources, ranged: true },
  pages: { label: 'Pages', component: Pages, ranged: true },
  events: { label: 'Events', component: Events, ranged: true },
  funnels: { label: 'Funnels', component: Funnels, ranged: true },
  revenue: { label: 'Revenue', component: Revenue, ranged: true },
  sessions: { label: 'Sessions', component: Sessions, ranged: true },
  realtime: { label: 'Live', component: Realtime, ranged: false },
  settings: { label: 'Settings', component: Settings, ranged: false },
}

const NAV: { value: DashboardView; label: string }[] = [
  { value: 'sites', label: 'All sites' },
  ...(Object.keys(VIEWS) as SiteView[]).map((value) => ({ value, label: VIEWS[value].label })),
]

export interface DashboardProps {
  /** Base URL of the analytik API, e.g. `/api`. */
  api: string
  /** Site shown first. Default: the first site. */
  siteId?: string
  /** Replaces `fetch`, e.g. to add headers. Requests use `credentials: 'include'`. */
  fetcher?: Fetcher
  /**
   * Forces a theme. Without it the dashboard follows the Appearance setting, which by default follows a
   * `data-theme` on the page or else `prefers-color-scheme`.
   */
  theme?: 'light' | 'dark'
  /** View shown first. Default `overview`. */
  view?: DashboardView
  /**
   * Site icons. Default `true`: each site's icon, fetched by the analytik server from the site (its `<link rel="icon">`, else `/favicon.ico`), so the browser never contacts the site. `false`
   * shows the site's initial; a function returns the icon URL for a site, or `undefined` for the initial.
   */
  favicons?: FaviconSource
  /**
   * Default `true`: the overview layout, live refresh and chart choices are saved in the database and follow the
   * admin to every browser. `false` keeps them in this browser only, e.g. for a shared read-only demo.
   */
  syncPreferences?: boolean
  /**
   * Keeps the open site and view in the address as `?site=<id>&section=pages`, so a refresh, a bookmark or a shared
   * link opens the same place, and Back steps through the views. Default false: an embedded dashboard leaves the
   * host page's address alone.
   */
  urlState?: boolean
  /** The line under the dashboard saying it is analytik, with links to its source and its author. Default true. */
  credits?: boolean
}

const NEW_SITE = '\u0000new'
// A live refresh reads the whole range again; once a minute keeps that affordable on metered databases.
const LIVE_MS = 60_000

/** The same preset ending now, keeping the chosen interval; custom ranges stay as they are. */
const renew = (range: DateRange): DateRange =>
  range.preset === 'custom' ? range : { ...presetRange(range.preset, Date.now()), interval: range.interval }

/** The site and view an address names, `?site=<id>&section=pages`; anything unknown is left out. */
function readAddress(): { site?: string; view?: DashboardView } {
  const params = new URLSearchParams(location.search)
  const section = params.get('section')
  const id = params.get('site')
  return {
    site: id ?? undefined,
    view: section && (section === 'sites' || section in VIEWS) ? (section as DashboardView) : undefined,
  }
}

/** The full dashboard: login, sites overview, site switcher, date range, filters and every view. */
export function Dashboard({
  api,
  siteId,
  fetcher,
  theme,
  view: initialView = 'overview',
  favicons = true,
  syncPreferences = true,
  credits = true,
  urlState = false,
}: DashboardProps) {
  const [unauthorized, setUnauthorized] = useState(false)
  const [chosenId, setChosenId] = useState(() => (urlState ? readAddress().site : undefined) ?? siteId)
  const [view, setViewState] = useState<DashboardView>(() => (urlState ? readAddress().view : undefined) ?? initialView)
  const [customizing, setCustomizing] = useState(false)
  const [range, setRange] = useState(() => presetRange('7d', Date.now()))
  const [filters, setFilters] = useState<Filters>({})
  const [adding, setAdding] = useState(false)
  // A site just added opens on its tracking code, the next thing to do with it.
  const [justAdded, setJustAdded] = useState<string | null>(null)
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
  // Saved in the database once signed in, so every browser shows the same layout and keeps live refresh on.
  const preferences = usePreferencesStore(syncPreferences ? client : undefined, !unauthorized)
  const live = preferences.values.live === true
  const setLive = (on: boolean): void => preferences.update({ live: on })

  // Switching views swaps the content for a short loading state. When the toolbar is stuck, the new view starts at
  // its top instead of wherever the scroll position ends up.
  const main = useRef<HTMLDivElement>(null)
  const setView = (next: DashboardView): void => {
    if (next !== 'settings') setJustAdded(null)
    const element = main.current
    const toolbar = element?.querySelector('.analytik-toolbar')
    if (element && toolbar && next !== view) {
      const stuckAt = toolbar.getBoundingClientRect().top
      if (element.getBoundingClientRect().top < stuckAt) {
        element.style.scrollMarginTop = `${stuckAt}px`
        element.scrollIntoView({ block: 'start' })
      }
    }
    setViewState(next)
  }

  // The header's height, so the sticky toolbar sits right under it.
  const header = useRef<HTMLElement>(null)
  useEffect(() => {
    const element = header.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() =>
      root?.style.setProperty('--analytik-header-height', `${element.offsetHeight}px`),
    )
    observer.observe(element)
    return () => observer.disconnect()
  })

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

  // The address follows the site and view: the first write only completes it, later ones are history entries.
  const addressed = useRef(false)
  const siteKey = site?.id
  useEffect(() => {
    if (!urlState || !siteKey) return
    const url = new URL(location.href)
    url.searchParams.set('site', siteKey)
    if (view === 'overview') url.searchParams.delete('section')
    else url.searchParams.set('section', view)
    if (url.href !== location.href) history[addressed.current ? 'pushState' : 'replaceState'](null, '', url)
    addressed.current = true
  }, [urlState, siteKey, view])
  useEffect(() => {
    if (!urlState) return
    const back = (): void => {
      const { site: id, view: next } = readAddress()
      setChosenId(id)
      setViewState(next ?? 'overview')
      setFilters({})
    }
    addEventListener('popstate', back)
    return () => removeEventListener('popstate', back)
  }, [urlState])
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
    client.clearCache()
    if (range.preset === 'custom') setGeneration((g) => g + 1)
    else setRange(renew(range))
  }
  const created = (next: Site): void => {
    setAdding(false)
    setChosenId(next.id)
    setJustAdded(next.id)
    setView('settings')
    sites.reload()
  }

  let content
  if (unauthorized) {
    content = <LoginForm client={client} onLogin={() => setUnauthorized(false)} />
  } else if (sites.loading || sites.error) {
    content = <Status loading={sites.loading} error={sites.error} />
  } else if (!site) {
    content = <CreateSiteForm client={client} onCreated={created} />
  } else if (!current) {
    content = (
      <SitesOverview
        client={client}
        sites={list}
        onOpen={(s) => {
          openSite(s.id)
          setView('overview')
        }}
        onAdd={() => setAdding(true)}
        onChange={sites.reload}
      />
    )
  } else {
    const View = current.component
    content = (
      <DashboardProvider
        client={client}
        apiUrl={apiUrl}
        site={site}
        range={range}
        filters={filters}
        onFilter={addFilter}
        onSiteChange={sites.reload}
        onViewChange={setView}
        customizing={customizing && view === 'overview'}
      >
        <div className="analytik-toolbar">
          <div className="analytik-action-left">
            <h1 className="analytik-sr-only">{current.label}</h1>
            <Select
              label="Site"
              hideLabel
              className="analytik-pill analytik-switcher"
              leading={<SiteTile site={site} />}
              value={site.id}
              options={[
                ...list.map((s) => ({
                  value: s.id,
                  label: s.name,
                  description: s.domain,
                  icon: <SiteTile site={s} />,
                })),
                {
                  value: NEW_SITE,
                  label: 'Add website…',
                  icon: (
                    <span className="analytik-tile analytik-tile-add" aria-hidden="true">
                      +
                    </span>
                  ),
                },
              ]}
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
          <div className="analytik-action-right">
            {view === 'overview' && customizing && (
              <ConfirmButton
                label="Reset"
                icon="reset"
                tone="plain"
                title="Reset the overview?"
                description="The overview goes back to the six default blocks, and the summary to its default numbers and chart. This changes it for every admin."
                confirmLabel="Reset layout"
                onConfirm={() => preferences.update({ layout: undefined, summary: undefined })}
              />
            )}
            {view === 'overview' && (
              <button
                type="button"
                className="analytik-button analytik-customize"
                data-variant={customizing ? 'primary' : undefined}
                aria-pressed={customizing}
                onClick={() => setCustomizing(!customizing)}
              >
                <Icon name={customizing ? 'check' : 'layout'} />
                {customizing ? 'Done' : 'Customize'}
              </button>
            )}
          </div>
        </div>
        {current.ranged && <FilterBar filters={filters} onChange={setFilters} />}
        <AnimatePresence mode="wait">
          {view === 'settings' ? (
            <Settings
              key={`${view}-${site.id}-${generation}`}
              section={justAdded === site.id ? 'tracking' : undefined}
            />
          ) : (
            <View key={`${view}-${site.id}-${generation}`} />
          )}
        </AnimatePresence>
      </DashboardProvider>
    )
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="analytik" data-theme={theme ?? parseTheme(preferences.values.theme)} ref={setRoot}>
        <PreferencesProvider value={preferences}>
          <LayerContext value={root}>
            <FaviconsContext value={favicons === true ? (s) => s.id && `${apiUrl}/sites/${s.id}/favicon` : favicons}>
              {!unauthorized && site && <UpdateNotice client={client} />}
              {!unauthorized && site && (
                <header className="analytik-header" ref={header}>
                  <span className="analytik-brand">
                    <BrandMark />
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
                              <motion.span
                                className="analytik-nav-pill"
                                layoutId="analytik-nav-pill"
                                aria-hidden="true"
                              />
                            )}
                            <span>{label}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </nav>
                  <ThemeToggle />
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
              <div
                className="analytik-main"
                ref={main}
                data-centered={unauthorized || (!sites.loading && !sites.error && !site) ? '' : undefined}
              >
                {content}
              </div>
              {credits && <Credits />}
              {!unauthorized && (
                <AddSiteDialog
                  client={client}
                  sites={list}
                  open={adding}
                  onCreated={created}
                  onClose={() => setAdding(false)}
                />
              )}
            </FaviconsContext>
          </LayerContext>
        </PreferencesProvider>
      </div>
    </MotionConfig>
  )
}
