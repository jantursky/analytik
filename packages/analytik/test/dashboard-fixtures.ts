import type { Fetcher } from '../src/dashboard/api'
import type {
  BreakdownRow,
  Funnel,
  Overview,
  Payment,
  Realtime,
  SessionSummary,
  Site,
  TimeseriesPoint,
} from '../src/shared/types'

export const site: Site = {
  id: 'site_1',
  name: 'Example',
  domain: 'example.com',
  timezone: 'UTC',
  currency: 'EUR',
  privacyMode: 'strict',
  retentionDays: null,
  allowLocalhost: false,
  ignoredIps: ['10.0.0.1'],
  createdAt: Date.UTC(2026, 0, 1),
}

export const otherSite: Site = { ...site, id: 'site_2', name: 'Other', domain: 'other.org', currency: 'USD' }

const delta = (value: number, previous: number) => ({
  value,
  previous,
  change: previous ? (value - previous) / previous : null,
})

export const overview: Overview = {
  visitors: delta(1200, 1000),
  sessions: delta(1500, 1500),
  pageviews: delta(4200, 4000),
  bounceRate: delta(0.42, 0.4),
  avgDurationMs: delta(83000, 90000),
  revenue: delta(129900, 0),
  orders: delta(13, 10),
  conversionRate: delta(0.0108, 0.01),
  revenuePerVisitor: delta(108, 90),
  currency: 'EUR',
  online: 4,
  otherCurrencies: [],
}

export const timeseries: TimeseriesPoint[] = [0, 1, 2, 3].map((i) => ({
  ts: Date.UTC(2026, 9, 20 + i),
  visitors: [100, 300, 200, 600][i] ?? 0,
  sessions: 150 + i,
  pageviews: 400 + i,
  revenue: [0, 4990, 0, 9900][i] ?? 0,
}))

export const row = (key: string, visitors: number, revenue = 0): BreakdownRow => ({
  key,
  visitors,
  sessions: visitors,
  pageviews: visitors * 2,
  revenue,
  orders: revenue ? 1 : 0,
  conversionRate: 0,
})

export const session: SessionSummary = {
  id: 'sess_1',
  visitorId: 'vis_1',
  startedAt: Date.UTC(2026, 9, 26, 10, 0, 0),
  durationMs: 125000,
  pageviews: 3,
  goals: 1,
  entryPage: '/pricing',
  exitPage: '/thanks',
  source: 'news.ycombinator.com',
  channel: 'Referral',
  country: 'DE',
  city: 'Berlin',
  browser: 'Firefox',
  os: 'Linux',
  device: 'desktop',
  revenue: 4990,
}

export const payment: Payment = {
  id: 'pay_1',
  siteId: 'site_1',
  provider: 'stripe',
  amount: 4990,
  currency: 'EUR',
  kind: 'payment',
  ts: Date.UTC(2026, 9, 26, 10, 5),
  visitorId: 'vis_1',
  sessionId: 'sess_1',
  customerId: 'cus_1',
  email: 'buyer@example.com',
  name: 'Ann Buyer',
  renewal: true,
  matchedBy: 'metadata',
  subscriptionId: null,
  orderId: null,
}

export const funnel: Funnel = {
  id: 'f1',
  name: 'Signup',
  steps: [
    { type: 'page', match: '/' },
    { type: 'goal', match: 'signup' },
  ],
}

export const realtime: Realtime = {
  online: 3,
  recent: [
    { ts: Date.now() - 5000, type: 'pageview', name: null, path: '/pricing', country: 'DE' },
    { ts: Date.now() - 90000, type: 'goal', name: 'signup', path: '/', country: null },
  ],
  locations: [
    { lat: 52.52, lon: 13.4, country: 'DE', city: 'Berlin' },
    { lat: 52.52, lon: 13.4, country: 'DE', city: 'Berlin' },
    { lat: 0, lon: 0, country: null, city: null },
  ],
}

export interface Recorded {
  method: string
  path: string
  params: Record<string, string>
  body: unknown
}

type Handler = (request: Recorded) => unknown

/**
 * An in-memory admin API: answers the dashboard's requests from fixtures and records them.
 * Handlers return JSON data, or a Response for status codes.
 */
export function fakeApi(overrides: Record<string, Handler> = {}) {
  const requests: Recorded[] = []
  const state = { sites: [site, otherSite], funnels: [funnel], loggedIn: true }

  const routes: Record<string, Handler> = {
    'POST /auth/login': ({ body }) => {
      if ((body as { password?: string }).password !== 'secret')
        return Response.json({ error: 'Wrong password' }, { status: 401 })
      state.loggedIn = true
      return { ok: true }
    },
    'POST /auth/logout': () => {
      state.loggedIn = false
      return { ok: true }
    },
    'GET /sites': () => state.sites,
    'POST /sites': ({ body }) => {
      const created = { ...site, ...(body as Partial<Site>), id: 'site_new' }
      state.sites = [...state.sites, created]
      return created
    },
    'PATCH /sites/:id': ({ body }) => ({ ...site, ...(body as Partial<Site>) }),
    'POST /sites/:id/rotate-key': () => ({ apiKey: 'ak_live_123' }),
    'GET /sites/:id/overview': () => overview,
    'GET /sites/:id/timeseries': () => timeseries,
    'GET /sites/:id/breakdown': ({ params }) =>
      params.dimension === 'page'
        ? [row('/', 900), row('/pricing', 300, 4990)]
        : params.dimension === 'channel'
          ? [row('Organic Search', 700, 9900), row('Direct', 500)]
          : [row(`${params.dimension}-a`, 10)],
    'GET /sites/:id/realtime': () => realtime,
    'GET /sites/:id/sessions': ({ params }) =>
      params.cursor
        ? { items: [{ ...session, id: 'sess_2' }], nextCursor: null }
        : { items: [session], nextCursor: 'c2' },
    'GET /sites/:id/sessions/:sid': () => ({
      session,
      events: [
        {
          id: 'e1',
          ts: session.startedAt,
          type: 'pageview',
          name: null,
          path: '/pricing',
          props: null,
          sessionId: 'sess_1',
          visitorId: 'vis_1',
        },
        {
          id: 'e2',
          ts: session.startedAt + 42000,
          type: 'goal',
          name: 'signup',
          path: '/pricing',
          props: null,
          sessionId: 'sess_1',
          visitorId: 'vis_1',
        },
      ],
    }),
    'GET /sites/:id/events': ({ params }) => ({
      items: [
        {
          id: 'e2',
          ts: session.startedAt,
          type: 'goal',
          name: params.name ?? 'signup',
          path: '/pricing',
          props: null,
          sessionId: 'sess_1',
          visitorId: 'vis_1',
        },
      ],
      nextCursor: null,
    }),
    'GET /sites/:id/funnels': () => state.funnels,
    'POST /sites/:id/funnels': ({ body }) => {
      const created = { ...(body as Omit<Funnel, 'id'>), id: `f${state.funnels.length + 1}` }
      state.funnels = [...state.funnels, created]
      return created
    },
    'DELETE /sites/:id/funnels/:fid': ({ path }) => {
      state.funnels = state.funnels.filter((f) => !path.endsWith(`/${f.id}`))
      return new Response(null, { status: 204 })
    },
    'GET /sites/:id/funnels/:fid': () => ({
      funnel,
      steps: [
        { match: '/', visitors: 1000, dropOff: null },
        { match: 'signup', visitors: 250, dropOff: 0.75 },
      ],
    }),
    'GET /sites/:id/payments': () => ({
      items: [
        payment,
        { ...payment, id: 'ref_1', kind: 'refund', amount: -4990, renewal: false, matchedBy: null, name: null },
      ],
      nextCursor: null,
    }),
    'POST /sites/:id/rematch': () => ({ matched: 1 }),
    'DELETE /sites/:id/data': () => ({ deleted: 10 }),
    ...overrides,
  }

  const match = (method: string, path: string): Handler | undefined => {
    for (const [route, handler] of Object.entries(routes)) {
      const [m, pattern] = route.split(' ') as [string, string]
      const regex = new RegExp(`^${pattern.replace(/:\w+/g, '[^/]+')}$`)
      if (m === method && regex.test(path)) return handler
    }
    return undefined
  }

  const fetcher: Fetcher = async (input, init = {}) => {
    const url = new URL(input, 'https://dash.example.com')
    const method = init.method ?? 'GET'
    const path = url.pathname.replace(/^\/api/, '')
    const recorded: Recorded = {
      method,
      path,
      params: Object.fromEntries(url.searchParams),
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    }
    requests.push(recorded)
    await Promise.resolve()
    if (!state.loggedIn && !path.startsWith('/auth/login'))
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const handler = match(method, path)
    if (!handler) return Response.json({ error: `No route ${method} ${path}` }, { status: 404 })
    const result = handler(recorded)
    return result instanceof Response ? result : Response.json(result)
  }

  return {
    fetcher,
    requests,
    state,
    /** Requests matching method and path prefix. */
    find: (method: string, path: string) => requests.filter((r) => r.method === method && r.path.startsWith(path)),
  }
}
