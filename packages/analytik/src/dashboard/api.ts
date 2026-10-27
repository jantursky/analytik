import type {
  BreakdownRow,
  Dimension,
  EventType,
  Funnel,
  FunnelResult,
  FunnelStep,
  Overview,
  Page,
  Payment,
  PaymentKind,
  PaymentProvider,
  PrivacyMode,
  Props,
  Query,
  Realtime,
  SessionSummary,
  Site,
  SiteSummary,
  TestDataInput,
  TestDataResult,
  TimeseriesPoint,
} from '../shared/types'

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>

export interface SiteInput {
  name: string
  domain: string
  timezone?: string
  currency?: string
  privacyMode?: PrivacyMode
  /** Days events and sessions are kept; null or left out keeps everything. */
  retentionDays?: number | null
}

export type SitePatch = Partial<Omit<Site, 'id' | 'createdAt'>> & {
  /** Webhook signing secrets per provider; write-only. */
  webhookSecrets?: Partial<Record<PaymentProvider, string>>
}

export interface EventRow {
  id: string
  ts: number
  type: EventType
  name: string | null
  path: string | null
  props: Props | null
  sessionId: string
  visitorId: string
}

export interface SessionDetail {
  session: SessionSummary
  events: EventRow[]
}

export interface FunnelInput {
  name: string
  steps: FunnelStep[]
}

export interface Paging {
  /** Keyset cursor from the previous page, in the default order only. */
  cursor?: string | null
  /** Rows to skip, for numbered pages. */
  offset?: number
  /** Rows per page; default 50, at most 500. */
  limit?: number
  /** A sort key of the list; default the time. */
  sort?: string
  /** Default `desc`. */
  order?: 'asc' | 'desc'
  /** Case-insensitive text matched in the list's text columns. */
  search?: string
  /** Only rows of this visitor id. */
  visitor?: string
}

export interface PaymentFilters {
  kind?: PaymentKind
  provider?: string
  /** `true`: matched to a visit; `false`: unattributed. */
  attributed?: boolean
}

export type ExportFormat = 'json' | 'csv'

/** Typed client for the admin routes. Every method rejects with `RequestError` on a non-2xx response. */
export interface ApiClient {
  login(password: string): Promise<unknown>
  logout(): Promise<unknown>
  /** Whether this browser is signed in, and how admins sign in: `password`, `custom` (the `verify()` option) or `none`. */
  me(): Promise<{ loggedIn: boolean; login: 'password' | 'custom' | 'none' }>
  sites(): Promise<Site[]>
  /** Every site's visitors, revenue and orders in the range (default the last 24 hours) and who is online. */
  summary(range?: { from: number; to: number }): Promise<SiteSummary[]>
  site(siteId: string): Promise<Site>
  /** Creates the site and resolves to it; its API key is shown later in the settings by rotating it. */
  createSite(input: SiteInput): Promise<Site>
  updateSite(siteId: string, patch: SitePatch): Promise<Site>
  /**
   * Deletes the site and all of its data. The server asks for proof: the site's domain typed out (`confirm`), and the
   * admin password unless admins sign in through `verify()`.
   */
  deleteSite(siteId: string, proof: { confirm: string; password?: string }): Promise<unknown>
  rotateKey(siteId: string): Promise<{ apiKey: string }>
  /** The dashboard settings shared by every admin; `{}` before anything was saved. */
  preferences(): Promise<Record<string, unknown>>
  savePreferences(preferences: Record<string, unknown>): Promise<Record<string, unknown>>
  /** Whether the server was started with `debug: true`. */
  debug(): Promise<{ enabled: boolean }>
  /** Writes made-up traffic and payments; needs `debug: true` on the server. */
  generateTestData(input: TestDataInput): Promise<TestDataResult>
  /** Removes the sites `generateTestData` made. */
  deleteTestSites(): Promise<{ deleted: number }>
  overview(siteId: string, query: Query): Promise<Overview>
  timeseries(siteId: string, query: Query): Promise<TimeseriesPoint[]>
  breakdown(siteId: string, dimension: Dimension, query: Query): Promise<BreakdownRow[]>
  realtime(siteId: string): Promise<Realtime>
  sessions(siteId: string, query: Query & Paging): Promise<Page<SessionSummary>>
  session(siteId: string, sessionId: string): Promise<SessionDetail>
  events(siteId: string, query: Query & Paging & { name?: string; type?: EventType }): Promise<Page<EventRow>>
  funnels(siteId: string): Promise<Funnel[]>
  createFunnel(siteId: string, input: FunnelInput): Promise<Funnel>
  deleteFunnel(siteId: string, funnelId: string): Promise<unknown>
  funnel(siteId: string, funnelId: string, query: Query): Promise<FunnelResult>
  payments(siteId: string, query: Query & Paging & PaymentFilters): Promise<Page<Payment>>
  rematch(siteId: string): Promise<unknown>
  purge(siteId: string, before: number): Promise<unknown>
  /** URL of the export download (cookie auth, so it works as a plain link). */
  exportUrl(siteId: string, format: ExportFormat): string
  /** Forgets the answers kept for a short while, so the next reads go to the server. */
  clearCache(): void
}

export class RequestError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'RequestError'
    this.status = status
  }
}

const iso = (ms: number): string => new Date(ms).toISOString()

/** Query string for a stats query: ISO dates, then interval, tz, paging and one key per filter. */
export function queryParams(
  query: Query & Paging & PaymentFilters & { name?: string; type?: EventType; dimension?: Dimension },
): URLSearchParams {
  const { from, to, filters, ...rest } = query
  const params = new URLSearchParams({ from: iso(from), to: iso(to) })
  for (const [key, value] of Object.entries({ ...rest, ...filters })) {
    if (value != null && value !== '') params.set(key, String(value))
  }
  return params
}

/**
 * How long a read is answered from memory. Views opened again soon after, and the parts of a view asking for the
 * same numbers, share one request; that matters when every request is billed, as on serverless hosts.
 */
const CACHE_MS = 60_000

export function createApiClient(api: string, fetcher: Fetcher = (input, init) => fetch(input, init)): ApiClient {
  const base = api.replace(/\/+$/, '')
  const cache = new Map<string, { at: number; done: boolean; value: Promise<unknown> }>()
  const site = (id: string): string => `/sites/${encodeURIComponent(id)}`

  async function request<T>(method: string, path: string, body?: unknown, params?: URLSearchParams): Promise<T> {
    const search = params?.size ? `?${params.toString()}` : ''
    const response = await fetcher(base + path + search, {
      method,
      credentials: 'include',
      headers: body === undefined ? { Accept: 'application/json' } : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    let data: unknown
    try {
      data = text ? JSON.parse(text) : undefined
    } catch {
      data = text
    }
    if (!response.ok) {
      const message = (data as { error?: unknown } | undefined)?.error
      throw new RequestError(response.status, typeof message === 'string' ? message : `HTTP ${response.status}`)
    }
    return data as T
  }

  /**
   * A read, shared with an identical one still on its way and, unless `fresh`, answered from the cache for a while.
   * Polling asks for `fresh` reads. Failures aren't kept.
   */
  const get = <T>(path: string, params?: URLSearchParams, fresh = false): Promise<T> => {
    const key = params?.size ? `${path}?${params.toString()}` : path
    const now = Date.now()
    const hit = cache.get(key)
    if (hit && (!hit.done || (!fresh && now - hit.at < CACHE_MS))) return hit.value as Promise<T>
    const entry = { at: now, done: false, value: request<T>('GET', path, undefined, params) as Promise<unknown> }
    cache.set(key, entry)
    entry.value.then(
      () => {
        entry.done = true
      },
      () => {
        if (cache.get(key) === entry) cache.delete(key)
      },
    )
    return entry.value as Promise<T>
  }
  // Anything written may change what was read before.
  const write = <T>(method: string, path: string, body?: unknown, params?: URLSearchParams): Promise<T> => {
    cache.clear()
    return request<T>(method, path, body, params).finally(() => cache.clear())
  }

  return {
    login: (password) => write('POST', '/auth/login', { password }),
    logout: () => write('POST', '/auth/logout', {}),
    me: () => get('/auth/me'),
    sites: () => get('/sites'),
    summary: (range) => get('/summary', range && new URLSearchParams({ from: iso(range.from), to: iso(range.to) })),
    site: (id) => get(site(id)),
    createSite: (input) => write<{ site: Site }>('POST', '/sites', input).then((created) => created.site),
    updateSite: (id, patch) => write('PATCH', site(id), patch),
    deleteSite: (id, proof) => write('DELETE', site(id), proof),
    rotateKey: (id) => write('POST', `${site(id)}/rotate-key`, {}),
    preferences: () => get('/preferences'),
    savePreferences: (preferences) => write('PUT', '/preferences', preferences),
    debug: () => get('/debug'),
    generateTestData: (input) => write('POST', '/debug/generate', input),
    deleteTestSites: () => write('DELETE', '/debug/sites'),
    overview: (id, query) => get(`${site(id)}/overview`, queryParams(query)),
    timeseries: (id, query) => get(`${site(id)}/timeseries`, queryParams(query)),
    breakdown: (id, dimension, query) => get(`${site(id)}/breakdown`, queryParams({ ...query, dimension })),
    realtime: (id) => get(`${site(id)}/realtime`, undefined, true),
    sessions: (id, query) => get(`${site(id)}/sessions`, queryParams(query)),
    session: (id, sessionId) => get(`${site(id)}/sessions/${encodeURIComponent(sessionId)}`),
    events: (id, query) => get(`${site(id)}/events`, queryParams(query)),
    funnels: (id) => get(`${site(id)}/funnels`),
    createFunnel: (id, input) => write('POST', `${site(id)}/funnels`, input),
    deleteFunnel: (id, funnelId) => write('DELETE', `${site(id)}/funnels/${encodeURIComponent(funnelId)}`),
    funnel: (id, funnelId, query) => get(`${site(id)}/funnels/${encodeURIComponent(funnelId)}`, queryParams(query)),
    payments: (id, query) => get(`${site(id)}/payments`, queryParams(query)),
    rematch: (id) => write('POST', `${site(id)}/rematch`, {}),
    purge: (id, before) => write('DELETE', `${site(id)}/data`, undefined, new URLSearchParams({ before: iso(before) })),
    exportUrl: (id, format) => `${base}${site(id)}/export?format=${format}`,
    clearCache: () => cache.clear(),
  }
}
