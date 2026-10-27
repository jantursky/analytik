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
  PaymentProvider,
  PrivacyMode,
  Props,
  Query,
  Realtime,
  SessionSummary,
  Site,
  TimeseriesPoint,
} from '../shared/types'

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>

export interface SiteInput {
  name: string
  domain: string
  timezone?: string
  currency?: string
  privacyMode?: PrivacyMode
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
  cursor?: string | null
}

export type ExportFormat = 'json' | 'csv'

/** Typed client for the admin routes. Every method rejects with `ApiError` on a non-2xx response. */
export interface ApiClient {
  login(password: string): Promise<unknown>
  logout(): Promise<unknown>
  me(): Promise<unknown>
  sites(): Promise<Site[]>
  site(siteId: string): Promise<Site>
  createSite(input: SiteInput): Promise<Site>
  updateSite(siteId: string, patch: SitePatch): Promise<Site>
  deleteSite(siteId: string): Promise<unknown>
  rotateKey(siteId: string): Promise<{ apiKey: string }>
  overview(siteId: string, query: Query): Promise<Overview>
  timeseries(siteId: string, query: Query): Promise<TimeseriesPoint[]>
  breakdown(siteId: string, dimension: Dimension, query: Query): Promise<BreakdownRow[]>
  realtime(siteId: string): Promise<Realtime>
  sessions(siteId: string, query: Query & Paging): Promise<Page<SessionSummary>>
  session(siteId: string, sessionId: string): Promise<SessionDetail>
  events(siteId: string, query: Query & Paging & { name?: string }): Promise<Page<EventRow>>
  funnels(siteId: string): Promise<Funnel[]>
  createFunnel(siteId: string, input: FunnelInput): Promise<Funnel>
  deleteFunnel(siteId: string, funnelId: string): Promise<unknown>
  funnel(siteId: string, funnelId: string, query: Query): Promise<FunnelResult>
  payments(siteId: string, query: Query & Paging): Promise<Page<Payment>>
  rematch(siteId: string): Promise<unknown>
  purge(siteId: string, before: number): Promise<unknown>
  /** URL of the export download (cookie auth, so it works as a plain link). */
  exportUrl(siteId: string, format: ExportFormat): string
}

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

const iso = (ms: number): string => new Date(ms).toISOString()

/** Query string for a stats query: ISO dates, then interval, tz, paging and one key per filter. */
export function queryParams(query: Query & Paging & { name?: string; dimension?: Dimension }): URLSearchParams {
  const { from, to, filters, ...rest } = query
  const params = new URLSearchParams({ from: iso(from), to: iso(to) })
  for (const [key, value] of Object.entries({ ...rest, ...filters })) {
    if (value != null && value !== '') params.set(key, value)
  }
  return params
}

export function createApiClient(api: string, fetcher: Fetcher = (input, init) => fetch(input, init)): ApiClient {
  const base = api.replace(/\/+$/, '')
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
      throw new ApiError(response.status, typeof message === 'string' ? message : `HTTP ${response.status}`)
    }
    return data as T
  }

  const get = <T>(path: string, params?: URLSearchParams): Promise<T> => request<T>('GET', path, undefined, params)

  return {
    login: (password) => request('POST', '/auth/login', { password }),
    logout: () => request('POST', '/auth/logout', {}),
    me: () => get('/auth/me'),
    sites: () => get('/sites'),
    site: (id) => get(site(id)),
    createSite: (input) => request('POST', '/sites', input),
    updateSite: (id, patch) => request('PATCH', site(id), patch),
    deleteSite: (id) => request('DELETE', site(id)),
    rotateKey: (id) => request('POST', `${site(id)}/rotate-key`, {}),
    overview: (id, query) => get(`${site(id)}/overview`, queryParams(query)),
    timeseries: (id, query) => get(`${site(id)}/timeseries`, queryParams(query)),
    breakdown: (id, dimension, query) => get(`${site(id)}/breakdown`, queryParams({ ...query, dimension })),
    realtime: (id) => get(`${site(id)}/realtime`),
    sessions: (id, query) => get(`${site(id)}/sessions`, queryParams(query)),
    session: (id, sessionId) => get(`${site(id)}/sessions/${encodeURIComponent(sessionId)}`),
    events: (id, query) => get(`${site(id)}/events`, queryParams(query)),
    funnels: (id) => get(`${site(id)}/funnels`),
    createFunnel: (id, input) => request('POST', `${site(id)}/funnels`, input),
    deleteFunnel: (id, funnelId) => request('DELETE', `${site(id)}/funnels/${encodeURIComponent(funnelId)}`),
    funnel: (id, funnelId, query) => get(`${site(id)}/funnels/${encodeURIComponent(funnelId)}`, queryParams(query)),
    payments: (id, query) => get(`${site(id)}/payments`, queryParams(query)),
    rematch: (id) => request('POST', `${site(id)}/rematch`, {}),
    purge: (id, before) =>
      request('DELETE', `${site(id)}/data`, undefined, new URLSearchParams({ before: iso(before) })),
    exportUrl: (id, format) => `${base}${site(id)}/export?format=${format}`,
  }
}
