import { AnimatePresence, motion, MotionConfig } from 'motion/react'
import { type ComponentType, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'

import { parseSegments } from '../shared/segments'
import type { Comparison, Filters, Site } from '../shared/types'
import { type AddressState, readAddress as parseAddress, writeAddress } from './address'
import { createApiClient, type Fetcher } from './api'
import { BrandMark } from './brand'
import { DashboardProvider, requestKey } from './context'
import { Credits } from './credits'
import { useResource } from './data'
import { loadMessages, type Messages, msg, resolveLanguage, setLanguage, t } from './i18n'
import { Icon } from './icons'
import { LanguageSwitch } from './language-switch'
import { AddSiteDialog, CreateSiteForm, LoginForm } from './Login'
import { savedCompare, savedRange } from './choices'
import { parseTheme, PreferencesProvider, usePreferencesStore } from './preferences'
import { type DateRange, presetRange, shiftRange } from './range'
import { sameFilters } from './segments'
import { useShortcuts } from './shortcuts'
import { NEXT_THEME, ThemeToggle } from './theme-toggle'
import { ComparePicker, FilterBar, IntervalPicker, RangePicker } from './Toolbar'
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
import { Settings, SETTINGS_SECTIONS, type SettingsSection } from './views/Settings'
import { SitesOverview } from './views/Sites'

// The palette and the shortcuts help load the first time they are opened.
const ImportDialog = lazy(() => import('./views/ImportDialog').then((m) => ({ default: m.ImportDialog })))
const Palette = lazy(() => import('./palette').then((m) => ({ default: m.Palette })))
const ShortcutHelp = lazy(() => import('./palette').then((m) => ({ default: m.ShortcutHelp })))

export type DashboardView =
  'sites' | 'overview' | 'sources' | 'pages' | 'events' | 'funnels' | 'revenue' | 'sessions' | 'realtime' | 'settings'

type SiteView = Exclude<DashboardView, 'sites'>

const VIEWS: Record<SiteView, { label: string; component: ComponentType; ranged: boolean }> = {
  overview: { label: msg('Overview'), component: Overview, ranged: true },
  sources: { label: msg('Acquisition'), component: Sources, ranged: true },
  pages: { label: msg('Pages'), component: Pages, ranged: true },
  events: { label: msg('Events'), component: Events, ranged: true },
  funnels: { label: msg('Funnels'), component: Funnels, ranged: true },
  revenue: { label: msg('Revenue'), component: Revenue, ranged: true },
  sessions: { label: msg('Sessions'), component: Sessions, ranged: true },
  realtime: { label: msg('Live'), component: Realtime, ranged: false },
  settings: { label: msg('Settings'), component: Settings, ranged: false },
}

const NAV: { value: DashboardView; label: string }[] = [
  { value: 'sites', label: msg('All sites') },
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
  /**
   * Keyboard shortcuts and the ⌘K / Ctrl+K command palette. Default `true`. They act only while focus is inside the
   * dashboard (or on the page, when `urlState` says the dashboard owns it), never while typing in a field or when a
   * dialog is open. Pass `false` when the host page needs the keys.
   */
  shortcuts?: boolean
  /**
   * The language, `'en'` or `'sk'`. Without it the dashboard follows the Language setting, which by default follows the
   * browser's language, else English.
   */
  locale?: string
  /** Replaces single strings, or adds a language: `{ sk: { Overview: 'Prehľad' }, en: { Overview: 'Home' } }`. */
  messages?: Record<string, Messages>
  /** The line under the dashboard saying it is analytik, with links to its source and its author. Default true. */
  credits?: boolean
}

const NEW_SITE = '\u0000new'
// A live refresh reads the whole range again; once a minute keeps that affordable on metered databases.
const LIVE_MS = 60_000

/** The same preset ending now, keeping the chosen interval; custom ranges stay as they are. */
const renew = (range: DateRange): DateRange =>
  range.preset === 'custom' ? range : { ...presetRange(range.preset, Date.now()), interval: range.interval }

const VOCABULARY = {
  views: ['sites', ...Object.keys(VIEWS)],
  tabs: SETTINGS_SECTIONS as readonly string[],
}

/** The state the current address names; anything unknown is left out. */
const readAddress = (): AddressState => parseAddress(location.search, VOCABULARY)

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
  shortcuts = true,
  locale,
  messages,
}: DashboardProps) {
  const [unauthorized, setUnauthorized] = useState(false)
  const [initial] = useState(() => (urlState ? readAddress() : undefined))
  const [chosenId, setChosenId] = useState(() => initial?.site ?? siteId)
  const [view, setViewState] = useState<DashboardView>(
    () => (initial?.view as DashboardView | undefined) ?? initialView,
  )
  const [tab, setTab] = useState<SettingsSection | undefined>(initial?.tab as SettingsSection | undefined)
  const [customizing, setCustomizing] = useState(false)
  const [range, setRange] = useState(() => initial?.range ?? presetRange('7d', Date.now()))
  const [filters, setFilters] = useState<Filters>(() => initial?.filters ?? {})
  const [compare, setCompare] = useState<Comparison | undefined>(initial?.compare)
  // A segment named in the address, applied once the saved segments are known (they may still be loading).
  const [pendingSegment, setPendingSegment] = useState(initial?.segment)
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
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
  // The period and comparison from the last visit, unless the address names its own or the admin already chose here.
  // Applied while rendering, like the linked segment below; the saved copy from the database may arrive later.
  const [choicesSettled, setChoicesSettled] = useState(() => !!(initial?.range ?? initial?.compare))
  const [mountedAt] = useState(() => Date.now())
  const savedPeriod = savedRange(preferences.values, mountedAt)
  const savedComparison = savedCompare(preferences.values)
  if (!choicesSettled && (savedPeriod || savedComparison)) {
    setChoicesSettled(true)
    if (savedPeriod) setRange(savedPeriod)
    if (savedComparison) setCompare(savedComparison)
  }
  // Presets are remembered for next time; a custom range is not.
  const chooseRange = (next: DateRange): void => {
    setChoicesSettled(true)
    setRange(next)
    if (next.preset !== 'custom') preferences.update({ period: next.preset, interval: next.interval })
  }
  const chooseCompare = (next: Comparison | undefined): void => {
    setChoicesSettled(true)
    setCompare(next)
    preferences.update({ compare: next })
  }
  const segments = parseSegments(preferences.values.segments)
  // Set while rendering, as React allows for a component's own state, rather than in an effect that renders twice.
  const linked = pendingSegment ? segments.find((s) => s.id === pendingSegment) : undefined
  if (linked) {
    setFilters(linked.filters)
    setPendingSegment(undefined)
  }
  const changeFilters = (next: Filters): void => {
    setPendingSegment(undefined)
    setFilters(next)
  }

  // The language comes from the prop, the saved choice or the browser. A catalog is fetched once per language; until
  // it arrives the dashboard reads in English. Like the format settings, it is set before the children render.
  const language = resolveLanguage(
    locale,
    preferences.values.language,
    typeof navigator === 'undefined' ? [] : navigator.languages,
  )
  const [catalog, setCatalog] = useState<{ language: string; messages: Messages }>({ language: 'en', messages: {} })
  useEffect(() => {
    let current = true
    void loadMessages(language).then((loaded) => {
      if (current) setCatalog({ language, messages: loaded })
    })
    return () => {
      current = false
    }
  }, [language])
  setLanguage(catalog.language, catalog.messages, messages?.[catalog.language])
  const setLive = (on: boolean): void => preferences.update({ live: on })

  // Switching views swaps the content for a short loading state. When the toolbar is stuck, the new view starts at
  // its top instead of wherever the scroll position ends up.
  const main = useRef<HTMLDivElement>(null)
  const setView = (next: DashboardView): void => {
    if (next !== 'settings') setTab(undefined)
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

  // A shadow under the toolbar once the view's content has scrolled beneath it.
  useEffect(() => {
    const update = (): void => {
      const toolbar = main.current?.querySelector('.analytik-toolbar')
      const content = main.current?.querySelector('.analytik-view')
      if (!toolbar || !content) return
      const under = content.getBoundingClientRect().top < toolbar.getBoundingClientRect().bottom - 1
      toolbar.toggleAttribute('data-stuck', under)
    }
    update()
    document.addEventListener('scroll', update, { capture: true, passive: true })
    window.addEventListener('resize', update)
    return () => {
      document.removeEventListener('scroll', update, { capture: true })
      window.removeEventListener('resize', update)
    }
  })

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

  // The address follows the whole state. Moving to another site or view adds a history entry, so Back steps through
  // places; anything else (Settings section, range, interval, filters) replaces it, so Back skips the clicks.
  const written = useRef<{ site: string; view: string } | null>(null)
  const siteKey = site?.id
  const nextUrl =
    urlState && siteKey
      ? writeAddress(new URL(location.href), {
          site: siteKey,
          view,
          tab,
          range,
          compare,
          filters,
          // A segment stands for its filters; until the saved segments have loaded the one in the address is kept.
          segment:
            segments.find((s) => Object.keys(filters).length > 0 && sameFilters(s.filters, filters))?.id ??
            (Object.keys(filters).length === 0 ? pendingSegment : undefined),
        })
      : null
  const nextHref = nextUrl?.href
  useEffect(() => {
    if (!nextUrl || !siteKey) return
    const place = { site: siteKey, view }
    const moved = written.current && (written.current.site !== place.site || written.current.view !== place.view)
    if (nextUrl.href !== location.href) history[moved ? 'pushState' : 'replaceState'](null, '', nextUrl)
    written.current = place
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nextHref stands for nextUrl, which is rebuilt every render
  }, [nextHref, siteKey, view])
  useEffect(() => {
    if (!urlState) return
    const back = (): void => {
      const next = readAddress()
      setChosenId(next.site)
      setViewState((next.view as DashboardView | undefined) ?? 'overview')
      setTab(next.tab as SettingsSection | undefined)
      setRange(next.range ?? presetRange('7d', Date.now()))
      setCompare(next.compare)
      setPendingSegment(next.segment)
      setFilters(next.filters)
    }
    addEventListener('popstate', back)
    return () => removeEventListener('popstate', back)
  }, [urlState])
  const current = view === 'sites' ? undefined : VIEWS[view]

  const addFilter = (dimension: string, value: string): void => {
    setPendingSegment(undefined)
    setFilters((f) => ({ ...f, [dimension]: value }))
    if (!current?.ranged) setView('overview')
  }
  const openSite = (id: string): void => {
    setChosenId(id)
    changeFilters({})
  }
  const refresh = (): void => {
    client.clearCache()
    if (range.preset === 'custom') setGeneration((g) => g + 1)
    else setRange(renew(range))
  }
  const [overlay, setOverlay] = useState<'palette' | 'help' | null>(null)
  // The values each breakdown block has loaded, so the palette can offer them as filters without asking again.
  const [known] = useState(() => new Map<string, string[]>())
  const pending = useShortcuts(
    root,
    {
      go: setView,
      step: (direction) => {
        const next = view !== 'sites' && VIEWS[view].ranged ? shiftRange(range, direction, Date.now()) : null
        if (next) setRange(next)
      },
      refresh,
      help: () => setOverlay('help'),
      palette: () => setOverlay('palette'),
    },
    { enabled: shortcuts && !unauthorized && sites.data !== undefined, global: urlState },
  )
  const created = (next: Site): void => {
    setAdding(false)
    setChosenId(next.id)
    // A site just added opens on its tracking code, the next thing to do with it.
    setTab('tracking')
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
        onImport={() => setImporting(true)}
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
        compare={compare}
        known={known}
        onFilter={addFilter}
        onSiteChange={sites.reload}
        onViewChange={setView}
        customizing={customizing && view === 'overview'}
      >
        <div className="analytik-toolbar">
          <div className="analytik-action-left">
            <h1 className="analytik-sr-only">{t(current.label)}</h1>
            <Select
              label={t('Site')}
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
                  label: t('Add website…'),
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
                <RangePicker range={range} onChange={chooseRange} />
                <IntervalPicker range={range} onChange={chooseRange} />
                <ComparePicker compare={compare} onChange={chooseCompare} />
                <Switch
                  className="analytik-pill analytik-live-toggle"
                  checked={liveOn}
                  disabled={range.preset === 'custom'}
                  onChange={setLive}
                >
                  <span className="analytik-live-dot" data-idle={liveOn ? undefined : ''} aria-hidden="true" />
                  {t('Live')}
                </Switch>
                <Tooltip label={t('Refresh')}>
                  <button
                    type="button"
                    className="analytik-pill-icon analytik-pill"
                    aria-label={t('Refresh')}
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
                label={t('Reset')}
                icon="reset"
                tone="plain"
                title={t('Reset the overview?')}
                description={t(
                  'The overview goes back to the six default blocks, and the summary to its default numbers and chart. This changes it for every admin.',
                )}
                confirmLabel={t('Reset layout')}
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
                {customizing ? t('Done') : t('Customize')}
              </button>
            )}
          </div>
        </div>
        {current.ranged && <FilterBar filters={filters} onChange={changeFilters} />}
        <AnimatePresence mode="wait">
          {view === 'settings' ? (
            <Settings key={`${view}-${site.id}-${generation}`} section={tab} onSectionChange={setTab} />
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
                  <div className="analytik-header-left">
                    <span className="analytik-brand">
                      <BrandMark />
                    </span>
                    <nav aria-label={t('Dashboard')}>
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
                              <span>{t(label)}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </nav>
                  </div>
                  <div className="analytik-header-right">
                    {locale === undefined && <LanguageSwitch />}
                    <ThemeToggle />
                    <button
                      type="button"
                      className="analytik-button analytik-signout"
                      onClick={() => void client.logout().finally(() => setUnauthorized(true))}
                    >
                      {t('Log out')}
                    </button>
                  </div>
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
              {pending && (
                <div className="analytik-chord-hint" role="status">
                  <kbd>{pending}</kbd> {t('then a letter to go to a view')}
                </div>
              )}
              <Suspense fallback={null}>
                {overlay === 'palette' && site && (
                  <Palette
                    onClose={() => setOverlay(null)}
                    controls={{
                      views: NAV,
                      go: setView,
                      sites: list,
                      siteId: site.id,
                      openSite,
                      setRange: chooseRange,
                      live,
                      setLive,
                      cycleTheme: () => {
                        const theme = parseTheme(preferences.values.theme) ?? 'system'
                        const next = NEXT_THEME[theme]
                        preferences.update({ theme: next === 'system' ? undefined : next })
                      },
                      refresh,
                      compare,
                      setCompare: chooseCompare,
                      segments,
                      applySegment: (segment) => changeFilters({ ...segment.filters }),
                      filters,
                      clearFilters: () => changeFilters({}),
                      addFilter,
                      known,
                    }}
                  />
                )}
                {overlay === 'help' && <ShortcutHelp views={NAV} onClose={() => setOverlay(null)} />}
              </Suspense>
              {!unauthorized && importing && (
                <Suspense>
                  <ImportDialog
                    client={client}
                    sites={list}
                    open
                    onClose={() => setImporting(false)}
                    onImported={sites.reload}
                    onOpen={(next) => {
                      openSite(next.id)
                      setView('overview')
                    }}
                  />
                </Suspense>
              )}
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
