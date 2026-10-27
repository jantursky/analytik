import type { AttributionIds, EventType, PrivacyMode, Props, TrackerPayload } from '../shared/types'
import { NAVIGATE, patchHistory } from './history'
import { attributeProps, clip, sanitizeProps } from './payload'
import type { AnalytikClient, AnalytikOptions, IdentifyInput, RevenueOptions } from './types'
import { cleanReferrer, cleanUrl, isLocalhost, isOutbound } from './url'

interface Ids {
  m: PrivacyMode
  vid?: string
  sid?: string
}

type Extra = Omit<Partial<TrackerPayload>, 'w' | 't'>
type Area = 'localStorage' | 'sessionStorage'

const VID = 'analytik_vid'
const SID = 'analytik_sid'
const IGNORE = 'analytik_ignore'
const PROBE = 'analytik_probe'
const CONSENT = 'analytik_consent'
const TAB = 'analytik_tab'
const YEAR = 31536000
const SESSION = 1800
// Activity updates while a page is open: often enough to keep the visitor in the five-minute live window, rare
// enough not to multiply the requests. They stop after half an hour on one page; the update on leaving carries the rest.
const PING_SECONDS = 240
const MIN_PING_SECONDS = 30
const PING_SPAN_SECONDS = 1800

const noop = (): void => undefined

export const noopEngine: AnalytikClient = {
  track: noop,
  revenue: noop,
  identify: noop,
  pageview: noop,
  attribution: () => Promise.resolve(null),
  consent: noop,
  withdrawConsent: noop,
  optOut: noop,
  optIn: noop,
  destroy: noop,
}

function read(area: Area, key: string): string | null {
  try {
    return window[area].getItem(key)
  } catch {
    return null
  }
}

function write(area: Area, key: string, value?: string): void {
  try {
    if (value == null) window[area].removeItem(key)
    else window[area].setItem(key, value)
  } catch {
    // Storage blocked: the setting lasts for this page only.
  }
}

function readCookie(name: string): string | null {
  const match = new RegExp('(?:^|; )' + name + '=([^;]*)').exec(document.cookie)
  return match ? decodeURIComponent(match[1] ?? '') : null
}

/** The widest domain that accepts a cookie, so `app.site.com` and `site.com` share one visitor. */
function rootDomain(): string | null {
  const parts = location.hostname.split('.')
  if (parts.length < 2 || /^\d+$/.test(parts[parts.length - 1] ?? '')) return null
  for (let i = parts.length - 2; i >= 0; i--) {
    const candidate = parts.slice(i).join('.')
    document.cookie = `${PROBE}=1; path=/; domain=${candidate}; SameSite=Lax`
    if (readCookie(PROBE)) {
      document.cookie = `${PROBE}=; path=/; domain=${candidate}; max-age=0`
      return candidate
    }
  }
  return null
}

const uuid = (): string =>
  'randomUUID' in crypto
    ? crypto.randomUUID()
    : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
        (+c ^ ((crypto.getRandomValues(new Uint8Array(1))[0] ?? 0) & (15 >> (+c / 4)))).toString(16),
      )

/** The tracker behind the script tag and `createClient()`. Call only in a browser. */
export function createEngine(options: AnalytikOptions): AnalytikClient {
  const w = window
  const d = document
  const loc = location
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean }
  const { site, domain, keepQuery: keep = [] } = options
  const mode: PrivacyMode = options.mode === 'enriched' || options.mode === 'persistent' ? options.mode : 'strict'
  const api = (options.api ?? '/api').replace(/\/+$/, '')
  const log = options.debug ? (...args: unknown[]) => console.info('[analytik]', ...args) : noop

  // Owners exclude their own browser by visiting any page with ?analytik_ignore=true (undo with =false).
  const ignore = new URLSearchParams(loc.search).get(IGNORE)
  if (ignore) write('localStorage', IGNORE, ignore === 'true' ? '1' : undefined)

  const disabled = !site
    ? 'no site id'
    : nav.webdriver
      ? 'automated browser'
      : isLocalhost(loc.hostname, loc.protocol) && !options.allowLocalhost
        ? 'localhost (allow with data-allow-localhost)'
        : ''
  if (disabled) {
    log('disabled:', disabled)
    return noopEngine
  }

  const offs: (() => void)[] = []
  const on = (target: EventTarget, type: string, fn: (event: Event) => void, capture = false): void => {
    target.addEventListener(type, fn, capture)
    offs.push(() => target.removeEventListener(type, fn, capture))
  }
  const visible = (): boolean => d.visibilityState === 'visible'
  const optedOut = (): boolean => read('localStorage', IGNORE) === '1'
  const dnt = nav.doNotTrack === '1' || nav.globalPrivacyControl === true
  const stored = read('localStorage', CONSENT)
  let consent: boolean | null =
    mode === 'enriched'
      ? read('sessionStorage', TAB)
        ? true
        : null
      : mode === 'persistent' && stored
        ? stored === '1'
        : null
  let tab: string | null = null
  let cookieDomain: string | null | undefined

  const setCookie = (name: string, value: string, maxAge: number): void => {
    if (cookieDomain === undefined) cookieDomain = domain ?? rootDomain()
    d.cookie =
      `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax` +
      (cookieDomain ? '; domain=' + cookieDomain : '') +
      (loc.protocol === 'https:' ? '; Secure' : '')
  }

  /** Current ids; creates them when the mode and consent allow. */
  function ids(): Ids {
    if (mode === 'enriched' && consent) {
      tab ??= read('sessionStorage', TAB) ?? uuid()
      write('sessionStorage', TAB, tab)
      return { m: mode, sid: tab }
    }
    // Persistent mode sets cookies unless consent was withdrawn, or DNT/GPC is on and consent was not given.
    if (mode === 'persistent' && (consent ?? !dnt)) {
      const vid = readCookie(VID) ?? uuid()
      const sid = readCookie(SID) ?? uuid()
      setCookie(VID, vid, YEAR)
      setCookie(SID, sid, SESSION) // sliding 30 minute session
      return { m: mode, vid, sid }
    }
    return { m: 'strict' }
  }

  function forget(): void {
    tab = null
    write('sessionStorage', TAB)
    if (readCookie(VID) != null) {
      setCookie(VID, '', -1)
      setCookie(SID, '', -1)
    }
  }

  function send(type: EventType, extra: Extra = {}, beacon = false, href = loc.href): void {
    if (optedOut()) {
      log('opted out, not sent:', type)
      return
    }
    const body: TrackerPayload = { w: site, t: type, u: cleanUrl(href, keep), sw: screen.width, ...ids(), ...extra }
    const json = JSON.stringify(body)
    const url = api + '/event'
    log(type, body)
    // text/plain keeps this a simple request: no CORS preflight, and sendBeacon accepts it.
    try {
      if (beacon && nav.sendBeacon(url, new Blob([json], { type: 'text/plain' }))) return
    } catch {
      // No sendBeacon: fall back to fetch.
    }
    fetch(url, {
      method: 'POST',
      body: json,
      keepalive: true,
      credentials: 'omit',
      headers: { 'Content-Type': 'text/plain' },
    }).catch((error: unknown) => log('failed:', error))
  }

  // ---- first pageview waits for an interaction or 3 s of visibility (bots, prerender, background tabs)
  let open = options.requireInteraction === false
  let gateTimer: ReturnType<typeof setTimeout> | undefined
  const waiting: (() => void)[] = []
  const whenOpen = (fn: () => void): void => {
    if (open) fn()
    else waiting.push(fn)
  }
  const openGate = (): void => {
    if (open) return
    open = true
    for (const fn of waiting.splice(0)) fn()
  }
  const armGate = (): void => {
    clearTimeout(gateTimer)
    if (!open && visible()) gateTimer = setTimeout(openGate, 3000)
  }
  if (!open) {
    for (const type of ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart']) on(w, type, openGate, true)
    armGate()
  }

  // ---- engaged time, counted only while the tab is visible
  let since = 0
  let pending = 0
  let pings = 0
  let last: string | null = null
  let lastPage: string | null = null
  let first = true

  /** Apps often replaceState the campaign keys away after landing; that is still the same pageview. */
  function samePage(href: string): boolean {
    const url = new URL(href)
    const params = url.searchParams
    for (const key of [...params.keys()]) if (/^(utm_\w+|ref|source)$/.test(key)) params.delete(key)
    url.search = params.toString()
    const page = url.href
    if (page === lastPage) return true
    lastPage = page
    return false
  }

  function flush(beacon: boolean): void {
    if (since) {
      pending += Date.now() - since
      since = visible() ? Date.now() : 0
    }
    if (pending >= 1000 && last) {
      send('ping', { d: Math.round(pending) }, beacon, last)
      pending = 0
    }
  }

  on(d, 'visibilitychange', () => {
    armGate()
    if (!visible()) flush(true)
    else if (open && last) since = Date.now()
  })
  on(w, 'pagehide', () => flush(true))
  const pingSeconds = options.pingInterval ?? PING_SECONDS
  const every = Number.isFinite(pingSeconds) && pingSeconds > 0 ? Math.max(MIN_PING_SECONDS, pingSeconds) : 0
  const maxPings = every ? Math.ceil(PING_SPAN_SECONDS / every) : 0
  // 0 turns the updates off: the time is sent only when the page is hidden or left.
  const interval = every
    ? setInterval(() => {
        if (visible() && pings < maxPings) {
          pings++
          flush(false)
        }
      }, every * 1000)
    : undefined

  function pageview(): void {
    const href = cleanUrl(loc.href, keep)
    if (samePage(href)) return
    flush(false)
    last = href
    const referrer = first ? cleanReferrer(d.referrer) : undefined
    first = false
    whenOpen(() => {
      pings = 0
      since = visible() ? Date.now() : 0
      send('pageview', { r: referrer }, false, href)
    })
  }

  function track(name: string, props?: Props): void {
    if (name) whenOpen(() => send('goal', { n: clip(name, 64), p: sanitizeProps(props) }, true))
  }

  // ---- clicks: declarative goals, outbound links, checkout links that carry the visitor
  function onClick(event: Event): void {
    const el = event.target instanceof Element ? event.target : null
    const goal = options.autoTrackAttrs !== false && el?.closest('[data-analytik-event]')
    if (goal) track(goal.getAttribute('data-analytik-event') ?? '', attributeProps(goal))
    const link = el?.closest('a[href]')
    if (!link) return
    try {
      const url = new URL(link.getAttribute('href') ?? '', loc.href)
      const { vid, sid } = /(^|\.)dodopayments\.com$/.test(url.hostname) ? ids() : {}
      if (vid && sid) {
        url.searchParams.set('metadata_analytik_visitor_id', vid)
        url.searchParams.set('metadata_analytik_session_id', sid)
        link.setAttribute('href', url.href)
      }
      if (options.autoOutbound !== false && isOutbound(url, loc.hostname, domain ?? cookieDomain ?? undefined)) {
        whenOpen(() => send('outbound', { n: url.origin + url.pathname }, true))
      }
    } catch {
      // Unparseable href.
    }
  }
  on(d, 'click', onClick, true)
  on(d, 'auxclick', onClick, true)

  function revenue(name: string, amount: number, { currency, orderId, ...props }: RevenueOptions = {}): void {
    if (!(amount > 0 && isFinite(amount))) {
      log('revenue ignored, amount must be a positive number:', amount)
      return
    }
    whenOpen(() =>
      send(
        'revenue',
        {
          n: clip(name || 'revenue', 64),
          a: amount,
          c: currency ? clip(currency, 3).toUpperCase() : undefined,
          o: orderId ? clip(orderId, 128) : undefined,
          p: sanitizeProps(props),
        },
        true,
      ),
    )
  }

  function identify(user: IdentifyInput): void {
    const { vid, sid } = ids()
    if (!vid && !sid && !consent) {
      log('identify ignored: needs consent in', mode, 'mode')
      return
    }
    whenOpen(() => send('identify', { p: sanitizeProps({ user_id: user.userId, email: user.email, name: user.name }) }))
  }

  async function attribution(): Promise<AttributionIds | null> {
    if (optedOut()) return null
    const { m, vid, sid } = ids()
    if (vid && sid) return { analytik_visitor_id: vid, analytik_session_id: sid }
    try {
      const response = await fetch(api + '/attribution', {
        method: 'POST',
        body: JSON.stringify({ w: site, u: cleanUrl(loc.href, keep), m, sid }),
        credentials: 'omit',
        headers: { 'Content-Type': 'text/plain' },
      })
      const ids = JSON.parse(await response.text()) as { visitorId?: string; sessionId?: string }
      return response.ok && ids.visitorId && ids.sessionId
        ? { analytik_visitor_id: ids.visitorId, analytik_session_id: ids.sessionId }
        : null
    } catch (error) {
      log('attribution failed:', error)
      return null
    }
  }

  if (options.autoPageviews !== false) {
    patchHistory()
    on(w, NAVIGATE, pageview)
    on(w, 'popstate', pageview)
    pageview()
  }

  return {
    track,
    revenue,
    identify,
    pageview,
    attribution,
    consent() {
      consent = true
      if (mode === 'persistent') write('localStorage', CONSENT, '1')
    },
    withdrawConsent() {
      consent = false
      forget()
      if (mode === 'persistent') write('localStorage', CONSENT, '0')
    },
    optOut() {
      write('localStorage', IGNORE, '1')
      forget()
    },
    optIn() {
      write('localStorage', IGNORE)
    },
    destroy() {
      for (const off of offs.splice(0)) off()
      clearInterval(interval)
      clearTimeout(gateTimer)
    },
  }
}
