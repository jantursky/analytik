import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { DAY, HOUR, MINUTE } from '../src/shared/time'
import type {
  BreakdownRow,
  EventRow,
  Funnel,
  FunnelResult,
  Overview,
  Page,
  Payment,
  Realtime,
  SessionDetail,
  SessionSummary,
  Site,
  SiteSummary,
  TimeseriesPoint,
} from '../src/shared/types'
import { storageKinds } from './helpers/databases'
import { CHROME, IPHONE, PASSWORD, START, type TestServer, testServer } from './helpers/server'

const DAY_START = Date.UTC(2026, 2, 16)
const RANGE = 'from=2026-03-16&to=2026-03-16&tz=UTC'

const germany = {
  'x-vercel-ip-country': 'DE',
  'x-vercel-ip-city': 'Berlin',
  'x-vercel-ip-latitude': '52.52',
  'x-vercel-ip-longitude': '13.40',
}
const usa = { 'x-vercel-ip-country': 'US', 'x-vercel-ip-city': 'Boston' }

/**
 * One day of traffic with known totals (all times UTC, 2026-03-16):
 *   v1/s1 08:00 Google, DE: / → /pricing, goal signup, 60 s engaged; pays 50.00, refunds 10.00
 *   v2/s2 09:00 newsletter (Email), US, iPhone: /blog/a (bounce)
 *   v1/s3 10:00 direct: / (bounce)
 *   v3/s4 11:00 t.co (Organic Social): /pricing, outbound to GitHub (bounce)
 *   pay_2 30.00 without a visitor
 * and one visit the day before (v9/s9, direct) for the deltas.
 */
async function seed(server: TestServer, site: Site, apiKey: string) {
  const at = (ms: number) => (server.now = ms - 1)
  const send = (payload: Record<string, unknown>, headers: Record<string, string> = {}) =>
    server.event({ w: site.id, ...payload }, headers)
  const ids = (n: number) => ({ m: 'persistent', vid: `visitor-000${n}`, sid: `session-000${n}` })
  const v1s3 = { m: 'persistent', vid: 'visitor-0001', sid: 'session-0003' }
  const v3s4 = { m: 'persistent', vid: 'visitor-0003', sid: 'session-0004' }

  at(DAY_START - 12 * HOUR)
  await send({ t: 'pageview', u: 'https://example.com/', m: 'persistent', vid: 'visitor-0009', sid: 'session-0009' })

  at(DAY_START + 8 * HOUR)
  await send({ t: 'pageview', u: 'https://example.com/', r: 'https://www.google.com/', ...ids(1) }, germany)
  await send({ t: 'pageview', u: 'https://example.com/pricing', ...ids(1) })
  await send({ t: 'goal', u: 'https://example.com/pricing', n: 'signup', p: { plan: 'pro' }, ...ids(1) })
  await send({ t: 'ping', u: 'https://example.com/pricing', d: 60_000, ...ids(1) })

  at(DAY_START + 9 * HOUR)
  await send(
    {
      t: 'pageview',
      u: 'https://example.com/blog/a?utm_source=newsletter&utm_medium=email&utm_campaign=spring',
      m: 'persistent',
      vid: 'visitor-0002',
      sid: 'session-0002',
    },
    { ...usa, 'user-agent': IPHONE },
  )

  at(DAY_START + 10 * HOUR)
  await send({ t: 'pageview', u: 'https://example.com/', ...v1s3 })

  at(DAY_START + 11 * HOUR)
  await send(
    { t: 'pageview', u: 'https://example.com/pricing', r: 'https://t.co/x', ...v3s4 },
    { 'user-agent': CHROME },
  )
  await send({ t: 'outbound', u: 'https://example.com/pricing', n: 'https://github.com/jantursky', ...v3s4 })

  const pay = (body: unknown) =>
    server.request('/v1/payments', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    })
  await pay({
    id: 'pay_1',
    amount: 5000,
    currency: 'USD',
    visitorId: 'visitor-0001',
    orderId: 'pi_1',
    ts: DAY_START + 12 * HOUR,
  })
  await pay({ id: 're_1', amount: 1000, currency: 'USD', kind: 'refund', orderId: 'pi_1', ts: DAY_START + 13 * HOUR })
  await pay({ id: 'pay_2', amount: 3000, currency: 'USD', ts: DAY_START + 14 * HOUR })
  server.now = DAY_START + 11 * HOUR + 2 * MINUTE
}

describe.each(storageKinds())('stats on %s', (kind) => {
  let server: TestServer
  let site: Site

  beforeAll(async () => {
    server = await testServer(kind)
    const created = await server.createSite({ privacyMode: 'persistent' })
    site = created.site
    await seed(server, site, created.apiKey)
  })

  afterAll(async () => {
    await server.close()
  })

  const get = <T>(path: string) => server.adminJson<T>(`/sites/${site.id}${path}`)

  it('overview: totals with period-over-period deltas', async () => {
    const overview = await get<Overview>(`/overview?${RANGE}`)
    expect(overview).toEqual({
      visitors: { value: 3, previous: 1, change: 2 },
      sessions: { value: 4, previous: 1, change: 3 },
      pageviews: { value: 5, previous: 1, change: 4 },
      bounceRate: { value: 0.75, previous: 1, change: -0.25 },
      avgDurationMs: { value: 15_000, previous: 0, change: null },
      revenue: { value: 7000, previous: 0, change: null },
      orders: { value: 2, previous: 0, change: null },
      conversionRate: { value: 2 / 3, previous: 0, change: null },
      revenuePerVisitor: { value: 7000 / 3, previous: 0, change: null },
      currency: 'USD',
      online: 1,
      otherCurrencies: [],
    })
  })

  it('compare: overview deltas against the same dates a year earlier', async () => {
    const overview = await get<Overview>(`/overview?${RANGE}&compare=year`)
    expect(overview.visitors).toEqual({ value: 3, previous: 0, change: null })
    expect((await get<Overview>(`/overview?${RANGE}&compare=previous`)).visitors).toEqual({
      value: 3,
      previous: 1,
      change: 2,
    })
  })

  it('compare: the series comes back with the earlier bucket at the same position', async () => {
    const plain = await get<TimeseriesPoint[]>(`/timeseries?${RANGE}&interval=hour`)
    expect(plain.some((point) => 'previous' in point)).toBe(false)
    const hourly = await get<TimeseriesPoint[]>(`/timeseries?${RANGE}&interval=hour&compare=previous`)
    expect(hourly).toHaveLength(24)
    // The visit the day before was at 12:00.
    expect(hourly[12]?.previous).toMatchObject({ ts: DAY_START - DAY + 12 * HOUR, visitors: 1, sessions: 1 })
    expect(hourly[11]?.previous).toMatchObject({ visitors: 0, sessions: 0 })
    expect(hourly[8]).toMatchObject({ visitors: 1, previous: { visitors: 0 } })
    const year = await get<TimeseriesPoint[]>(`/timeseries?${RANGE}&interval=day&compare=year`)
    expect(year[0]?.previous).toMatchObject({ visitors: 0, revenue: 0 })
  })

  it('compare: breakdown rows carry their numbers from the earlier period', async () => {
    const plain = await get<BreakdownRow[]>(`/breakdown?${RANGE}&dimension=channel`)
    expect(plain.some((row) => 'previous' in row)).toBe(false)
    const rows = await get<BreakdownRow[]>(`/breakdown?${RANGE}&dimension=channel&compare=previous`)
    expect(rows.find((row) => row.key === 'Direct')?.previous).toMatchObject({ visitors: 1, sessions: 1 })
    expect(rows.find((row) => row.key === 'Email')?.previous).toEqual({
      visitors: 0,
      sessions: 0,
      pageviews: 0,
      revenue: 0,
      orders: 0,
      conversionRate: 0,
    })
  })

  it('compare: ignores unknown values and works through the stats API', async () => {
    expect((await get<TimeseriesPoint[]>(`/timeseries?${RANGE}&interval=day&compare=bogus`))[0]).not.toHaveProperty(
      'previous',
    )
    const [point] = await server.analytik.stats.timeseries(site.id, {
      from: DAY_START,
      to: DAY_START + DAY,
      interval: 'day',
      compare: 'previous',
    })
    expect(point?.previous?.visitors).toBe(1)
  })

  it('summary: every site in one request, matching the overview', async () => {
    const empty = await server.createSite({ domain: 'quiet.example.org', currency: 'EUR' })
    const summary = await server.adminJson<SiteSummary[]>('/summary?from=2026-03-16&to=2026-03-16')
    expect(summary).toHaveLength(2)
    expect(summary).toEqual(
      expect.arrayContaining([
        { siteId: site.id, visitors: 3, revenue: 7000, orders: 2, currency: 'USD', online: 1 },
        { siteId: empty.site.id, visitors: 0, revenue: 0, orders: 0, currency: 'EUR', online: 0 },
      ]),
    )
    // Default: the last 24 hours, which take in the visit the evening before too.
    const recent = await server.adminJson<SiteSummary[]>('/summary')
    expect(recent.find((row) => row.siteId === site.id)?.visitors).toBe(4)
    const refused = await server.admin('/summary?from=2026-03-17&to=2026-03-16')
    expect(refused.status).toBe(400)
    expect((await server.admin('/summary?from=soon')).status).toBe(400)
    expect((await server.request('/summary')).status).toBe(401)
    await server.admin(`/sites/${empty.site.id}`, {
      method: 'DELETE',
      json: { confirm: 'quiet.example.org', password: PASSWORD },
    })
  })

  it('overview: filters by session attributes and events', async () => {
    const organic = await get<Overview>(`/overview?${RANGE}&channel=Organic%20Search`)
    expect([organic.visitors.value, organic.sessions.value, organic.revenue.value, organic.orders.value]).toEqual([
      1, 1, 4000, 1,
    ])
    const countries = await get<Overview>(`/overview?${RANGE}&country=DE&country=US`)
    expect(countries.sessions.value).toBe(2)
    expect((await get<Overview>(`/overview?${RANGE}&country=`)).sessions.value).toBe(2)
    expect((await get<Overview>(`/overview?${RANGE}&page=/blog/*`)).sessions.value).toBe(1)
    expect((await get<Overview>(`/overview?${RANGE}&goal=signup`)).sessions.value).toBe(1)
    expect((await get<Overview>(`/overview?${RANGE}&outbound=https://github.com/jantursky`)).sessions.value).toBe(1)
    expect((await get<Overview>(`/overview?${RANGE}&entry=/&exit=/pricing`)).sessions.value).toBe(1)
  })

  it('timeseries: one point per bucket in the requested timezone', async () => {
    const hourly = await get<TimeseriesPoint[]>(`/timeseries?${RANGE}&interval=hour`)
    expect(hourly).toHaveLength(24)
    expect(hourly[8]).toMatchObject({
      ts: DAY_START + 8 * HOUR,
      visitors: 1,
      sessions: 1,
      pageviews: 2,
      revenue: 0,
      orders: 0,
      bounceRate: 0,
      conversionRate: 0,
    })
    expect(hourly[12]).toMatchObject({
      ts: DAY_START + 12 * HOUR,
      visitors: 0,
      sessions: 0,
      revenue: 5000,
      orders: 1,
      bounceRate: 0,
      avgDurationMs: 0,
      conversionRate: 0,
      revenuePerVisitor: 0,
    })
    expect(hourly[13]?.revenue).toBe(-1000)
    expect(hourly.reduce((sum, point) => sum + point.sessions, 0)).toBe(4)

    const local = await get<TimeseriesPoint[]>(
      '/timeseries?from=2026-03-15&to=2026-03-16&tz=America/New_York&interval=day',
    )
    expect(local.map((point) => point.ts)).toEqual([Date.UTC(2026, 2, 15, 4), Date.UTC(2026, 2, 16, 4)])
    expect(local.map((point) => point.sessions)).toEqual([1, 4])

    const filtered = await get<TimeseriesPoint[]>(`/timeseries?${RANGE}&interval=day&channel=Organic%20Search`)
    expect(filtered).toEqual([
      {
        ts: DAY_START,
        visitors: 1,
        sessions: 1,
        pageviews: 2,
        revenue: 4000,
        orders: 1,
        bounceRate: 0,
        avgDurationMs: filtered[0]?.avgDurationMs,
        conversionRate: 1,
        revenuePerVisitor: 4000,
      },
    ])
    const daily = await get<TimeseriesPoint[]>(`/timeseries?${RANGE}&interval=day`)
    expect(daily[0]?.bounceRate).toBe(0.75)
  })

  it('breakdown: session dimensions with revenue credited to the visit', async () => {
    const channels = await get<BreakdownRow[]>(`/breakdown?${RANGE}&dimension=channel`)
    expect(channels).toEqual([
      { key: 'Direct', visitors: 1, sessions: 1, pageviews: 1, revenue: 0, orders: 0, conversionRate: 0 },
      { key: 'Email', visitors: 1, sessions: 1, pageviews: 1, revenue: 0, orders: 0, conversionRate: 0 },
      { key: 'Organic Search', visitors: 1, sessions: 1, pageviews: 2, revenue: 4000, orders: 1, conversionRate: 1 },
      { key: 'Organic Social', visitors: 1, sessions: 1, pageviews: 1, revenue: 0, orders: 0, conversionRate: 0 },
    ])
    const sources = await get<BreakdownRow[]>(`/breakdown?${RANGE}&dimension=source&limit=2`)
    expect(sources).toHaveLength(2)
    const countries = await get<BreakdownRow[]>(`/breakdown?${RANGE}&dimension=country`)
    expect(countries.map((row) => [row.key, row.sessions])).toEqual([
      ['', 2],
      ['DE', 1],
      ['US', 1],
    ])
    const campaigns = await get<BreakdownRow[]>(`/breakdown?${RANGE}&dimension=campaign&medium=email`)
    expect(campaigns.map((row) => row.key)).toEqual(['spring'])
    for (const dimension of [
      'referrer',
      'term',
      'content',
      'ref',
      'entry',
      'exit',
      'region',
      'city',
      'browser',
      'os',
      'device',
    ]) {
      const rows = await get<BreakdownRow[]>(`/breakdown?${RANGE}&dimension=${dimension}`)
      expect(
        rows.reduce((sum, row) => sum + row.sessions, 0),
        dimension,
      ).toBe(4)
    }
  })

  it('breakdown: pages, goals and outbound links from events', async () => {
    const pages = await get<BreakdownRow[]>(`/breakdown?${RANGE}&dimension=page`)
    expect(pages).toEqual([
      { key: '/pricing', visitors: 2, sessions: 2, pageviews: 2, revenue: 4000, orders: 1, conversionRate: 0.5 },
      { key: '/', visitors: 1, sessions: 2, pageviews: 2, revenue: 4000, orders: 1, conversionRate: 1 },
      { key: '/blog/a', visitors: 1, sessions: 1, pageviews: 1, revenue: 0, orders: 0, conversionRate: 0 },
    ])
    for (const dimension of ['goal', 'event']) {
      expect(await get<BreakdownRow[]>(`/breakdown?${RANGE}&dimension=${dimension}`)).toEqual([
        { key: 'signup', visitors: 1, sessions: 1, pageviews: 1, revenue: 4000, orders: 1, conversionRate: 1 },
      ])
    }
    const outbound = await get<BreakdownRow[]>(`/breakdown?${RANGE}&dimension=outbound&device=Desktop`)
    expect(outbound.map((row) => row.key)).toEqual(['https://github.com/jantursky'])
  })

  it('breakdown: revenue from visits outside the range still shows up', async () => {
    const rows = await get<BreakdownRow[]>(
      '/breakdown?from=2026-03-16T12:00:00Z&to=2026-03-17&tz=UTC&dimension=channel',
    )
    expect(rows).toEqual([
      { key: 'Organic Search', visitors: 0, sessions: 0, pageviews: 0, revenue: 4000, orders: 1, conversionRate: 0 },
    ])
  })

  it('rejects unknown dimensions and bad ranges', async () => {
    const status = async (path: string) => (await server.admin(`/sites/${site.id}${path}`)).status
    expect(await status(`/breakdown?${RANGE}&dimension=planet`)).toBe(400)
    expect(await status('/overview?from=2026-03-17&to=2026-03-16')).toBe(400)
    expect(await status('/overview?from=yesterday')).toBe(400)
    expect(await status('/overview?tz=Nowhere/City')).toBe(400)
    expect(await status('/overview')).toBe(200)
  })

  it('realtime: visitors online, recent events and locations', async () => {
    const realtime = await get<Realtime>('/realtime')
    expect(realtime.online).toBe(1)
    expect(realtime.recent.slice(0, 2)).toEqual([
      {
        ts: DAY_START + 11 * HOUR + 1,
        type: 'outbound',
        name: 'https://github.com/jantursky',
        path: '/pricing',
        country: null,
      },
      { ts: DAY_START + 11 * HOUR, type: 'pageview', name: null, path: '/pricing', country: null },
    ])
    expect(realtime.locations).toEqual([])
    server.now = DAY_START + 8 * HOUR + 2 * MINUTE
    const [berlin, ...others] = (await get<Realtime>('/realtime')).locations
    expect(others).toEqual([])
    expect(berlin).toMatchObject({ lat: 52.52, lon: 13.4, country: 'DE', city: 'Berlin' })
    expect(typeof berlin?.sessionId).toBe('string')
    expect(typeof berlin?.visitorId).toBe('string')
    expect(berlin?.page).toMatch(/^\//)
    expect(berlin?.source).toBeTruthy()
    expect(berlin?.lastSeen).toBeGreaterThanOrEqual(berlin?.startedAt ?? Infinity)
    server.now = DAY_START + 11 * HOUR + 2 * MINUTE
  })

  it('sessions: newest first with cursor pagination', async () => {
    const first = await get<Page<SessionSummary>>(`/sessions?${RANGE}&limit=3`)
    expect(first.items.map((item) => item.id)).toEqual(['session-0004', 'session-0003', 'session-0002'])
    expect(first.nextCursor).toEqual(expect.any(String))
    const second = await get<Page<SessionSummary>>(`/sessions?${RANGE}&limit=3&cursor=${first.nextCursor ?? ''}`)
    expect(second).toMatchObject({
      items: [{ id: 'session-0001', revenue: 4000, durationMs: 60_000, goals: 1 }],
      nextCursor: null,
    })
    expect((await server.admin(`/sites/${site.id}/sessions?cursor=garbage`)).status).toBe(400)
    expect((await server.admin(`/sites/${site.id}/sessions?cursor=${btoa('{"a":1}')}`)).status).toBe(400)
  })

  it('session detail: events, payments and the visitor', async () => {
    const detail = await get<SessionDetail>('/sessions/session-0001')
    expect(detail.session).toMatchObject({
      id: 'session-0001',
      entryPage: '/',
      exitPage: '/pricing',
      country: 'DE',
      channel: 'Organic Search',
    })
    expect(detail.visitor).toMatchObject({ id: 'visitor-0001', sessions: 2, email: null })
    expect(detail.events.map((event) => [event.type, event.path, event.name])).toEqual([
      ['pageview', '/', null],
      ['pageview', '/pricing', null],
      ['goal', '/pricing', 'signup'],
    ])
    expect(detail.events[2]?.props).toEqual({ plan: 'pro' })
    expect(detail.payments.map((payment) => payment.amount)).toEqual([5000, -1000])
    expect((await server.admin(`/sites/${site.id}/sessions/nope`)).status).toBe(404)
  })

  it('events: filtered by name and type, paginated', async () => {
    const signups = await get<Page<EventRow>>(`/events?${RANGE}&name=signup`)
    expect(signups.items).toMatchObject([
      { type: 'goal', name: 'signup', sessionId: 'session-0001', visitorId: 'visitor-0001' },
    ])
    const pageviews = await get<Page<EventRow>>(`/events?${RANGE}&type=pageview&limit=4`)
    expect(pageviews.items).toHaveLength(4)
    const rest = await get<Page<EventRow>>(
      `/events?${RANGE}&type=pageview&limit=4&cursor=${pageviews.nextCursor ?? ''}`,
    )
    expect(rest).toMatchObject({ items: [{ path: '/' }], nextCursor: null })
    expect((await server.admin(`/sites/${site.id}/events?type=ping`)).status).toBe(400)
  })

  it('payments: newest first, refunds included', async () => {
    const page = await get<Page<Payment>>(`/payments?${RANGE}&limit=2`)
    expect(page.items.map((payment) => payment.id)).toEqual(['pay_2', 're_1'])
    const next = await get<Page<Payment>>(`/payments?${RANGE}&limit=2&cursor=${page.nextCursor ?? ''}`)
    expect(next.items.map((payment) => [payment.id, payment.matchedBy, payment.renewal])).toEqual([
      ['pay_1', 'metadata', false],
    ])
  })

  it('lists: numbered pages with a total, any sort order and search', async () => {
    const all = await get<Page<SessionSummary>>(`/sessions?${RANGE}`)
    expect(all.total).toBe(4)
    expect(await get<Page<SessionSummary>>(`/sessions?${RANGE}&limit=3&offset=3`)).toMatchObject({
      items: [{ id: 'session-0001' }],
      nextCursor: null,
      total: 4,
    })
    const ascending = (values: number[]) => values.every((v, i) => i === 0 || values[i - 1]! <= v)
    const pages = (await get<Page<SessionSummary>>(`/sessions?${RANGE}&sort=pageviews&order=asc`)).items
    expect(ascending(pages.map((s) => s.pageviews))).toBe(true)
    const revenue = (await get<Page<SessionSummary>>(`/sessions?${RANGE}&sort=revenue`)).items
    expect(ascending(revenue.map((s) => -s.revenue))).toBe(true)
    expect(revenue[0]?.revenue).toBe(4000)
    // Unknown values sort last in both directions, on every database.
    for (const order of ['asc', 'desc']) {
      const countries = (await get<Page<SessionSummary>>(`/sessions?${RANGE}&sort=country&order=${order}`)).items
      const firstUnknown = countries.findIndex((s) => s.country === null)
      if (firstUnknown >= 0) expect(countries.slice(firstUnknown).every((s) => s.country === null)).toBe(true)
    }
    const oldest = await get<Page<SessionSummary>>(`/sessions?${RANGE}&order=asc&limit=1`)
    expect(oldest).toMatchObject({ items: [{ id: 'session-0001' }], nextCursor: null })

    const pricing = await get<Page<SessionSummary>>(`/sessions?${RANGE}&search=PRICING`)
    expect(pricing.total).toBeGreaterThan(0)
    expect(pricing.items.every((s) => [s.entryPage, s.exitPage].some((p) => p?.includes('/pricing')))).toBe(true)
    expect(await get<Page<EventRow>>(`/events?${RANGE}&search=sign`)).toMatchObject({
      items: [{ name: 'signup' }],
      total: 1,
    })
    // Wildcards in the search are literal characters.
    expect((await get<Page<EventRow>>(`/events?${RANGE}&search=%25`)).total).toBe(0)
    expect((await get<Page<EventRow>>(`/events?${RANGE}&search=_`)).total).toBe(0)
    const named = (await get<Page<EventRow>>(`/events?${RANGE}&sort=name&order=asc`)).items
    expect(named[0]?.name).not.toBeNull()
    expect(named.at(-1)?.name).toBeNull()
  })

  it('payments: filtered by kind, provider and attribution, sorted by amount', async () => {
    const all = (await get<Page<Payment>>(`/payments?${RANGE}`)).items
    const ids = async (params: string) =>
      (await get<Page<Payment>>(`/payments?${RANGE}&${params}`)).items.map((p) => p.id)
    expect(await ids('kind=refund')).toEqual(all.filter((p) => p.kind === 'refund').map((p) => p.id))
    expect(await ids('kind=payment&attributed=true')).toEqual(
      all.filter((p) => p.kind === 'payment' && p.matchedBy).map((p) => p.id),
    )
    expect(await ids('attributed=false')).toEqual(all.filter((p) => !p.matchedBy).map((p) => p.id))
    expect(await ids(`provider=${all[0]?.provider ?? ''}`)).toHaveLength(
      all.filter((p) => p.provider === all[0]?.provider).length,
    )
    expect(await ids('provider=nobody')).toEqual([])
    const amounts = (await get<Page<Payment>>(`/payments?${RANGE}&sort=amount&order=asc`)).items.map((p) => p.amount)
    expect(amounts).toEqual([...amounts].sort((a, b) => a - b))
    expect(await ids('search=PAY_1')).toEqual(['pay_1'])
    for (const sort of ['provider', 'customer', 'attribution', 'time']) {
      expect((await get<Page<Payment>>(`/payments?${RANGE}&sort=${sort}`)).total).toBe(all.length)
    }
    const buyer = all.find((p) => p.visitorId)?.visitorId ?? ''
    expect(await ids(`visitor=${buyer}`)).toEqual(all.filter((p) => p.visitorId === buyer).map((p) => p.id))
  })

  it("lists: one visitor's sessions and events", async () => {
    const all = (await get<Page<SessionSummary>>(`/sessions?${RANGE}`)).items
    const visitor = all[0]?.visitorId ?? ''
    const theirs = await get<Page<SessionSummary>>(`/sessions?${RANGE}&visitor=${visitor}`)
    expect(theirs.total).toBe(all.filter((s) => s.visitorId === visitor).length)
    expect(theirs.items.every((s) => s.visitorId === visitor)).toBe(true)
    const events = await get<Page<EventRow>>(`/events?${RANGE}&visitor=${visitor}`)
    expect(events.total).toBeGreaterThan(0)
    expect(events.items.every((e) => e.visitorId === visitor)).toBe(true)
    expect((await get<Page<EventRow>>(`/events?${RANGE}&visitor=nobody`)).total).toBe(0)
  })

  it('lists reject unknown sorts, orders and filters', async () => {
    const status = async (path: string) => (await server.admin(`/sites/${site.id}${path}`)).status
    const first = await get<Page<SessionSummary>>(`/sessions?${RANGE}&limit=1`)
    expect(await status(`/sessions?${RANGE}&sort=planet`)).toBe(400)
    expect(await status(`/sessions?${RANGE}&order=up`)).toBe(400)
    expect(await status(`/sessions?${RANGE}&offset=-1`)).toBe(400)
    expect(await status(`/sessions?${RANGE}&sort=duration&cursor=${first.nextCursor ?? ''}`)).toBe(400)
    expect(await status(`/sessions?${RANGE}&offset=1&cursor=${first.nextCursor ?? ''}`)).toBe(400)
    expect(await status(`/payments?${RANGE}&kind=gift`)).toBe(400)
    expect(await status(`/payments?${RANGE}&attributed=maybe`)).toBe(400)
    for (const sort of ['time', 'duration', 'pageviews', 'source', 'country', 'entry', 'revenue']) {
      expect(await status(`/sessions?${RANGE}&sort=${sort}`)).toBe(200)
    }
    for (const sort of ['time', 'type', 'name', 'page']) expect(await status(`/events?${RANGE}&sort=${sort}`)).toBe(200)
  })

  it('funnels: create, list, compute and delete', async () => {
    const funnel = await server.adminJson<Funnel>(`/sites/${site.id}/funnels`, {
      method: 'POST',
      json: {
        name: ' Signup ',
        steps: [
          { type: 'page', match: '/' },
          { type: 'page', match: '/pri*' },
          { type: 'goal', match: 'signup' },
        ],
      },
    })
    expect(funnel.name).toBe('Signup')
    expect(await get<Funnel[]>('/funnels')).toEqual([funnel])
    const result = await get<FunnelResult>(`/funnels/${funnel.id}?${RANGE}`)
    expect(result.steps).toEqual([
      { match: '/', visitors: 1, dropOff: null },
      { match: '/pri*', visitors: 1, dropOff: 0 },
      { match: 'signup', visitors: 1, dropOff: 0 },
    ])
    const blog = await server.adminJson<Funnel>(`/sites/${site.id}/funnels`, {
      method: 'POST',
      json: {
        name: 'Blog',
        steps: [
          { type: 'page', match: '/blog/*' },
          { type: 'goal', match: 'signup' },
          { type: 'goal', match: 'never' },
        ],
      },
    })
    expect((await get<FunnelResult>(`/funnels/${blog.id}?${RANGE}`)).steps).toEqual([
      { match: '/blog/*', visitors: 1, dropOff: null },
      { match: 'signup', visitors: 0, dropOff: 1 },
      { match: 'never', visitors: 0, dropOff: null },
    ])
    for (const json of [
      {},
      { name: 'x', steps: [] },
      { name: 'x', steps: [{ type: 'page' }, { type: 'x', match: '/' }] },
    ]) {
      expect((await server.admin(`/sites/${site.id}/funnels`, { method: 'POST', json })).status).toBe(400)
    }
    expect(await server.adminJson(`/sites/${site.id}/funnels/${blog.id}`, { method: 'DELETE' })).toEqual({ ok: true })
    expect((await server.admin(`/sites/${site.id}/funnels/${blog.id}`, { method: 'DELETE' })).status).toBe(404)
    expect((await server.admin(`/sites/${site.id}/funnels/${blog.id}`)).status).toBe(404)
  })

  it('stats API for server code', async () => {
    const { stats } = server.analytik
    const query = {
      from: DAY_START,
      to: DAY_START + DAY,
      filters: { channel: 'Organic Search', planet: 'x', city: undefined },
    }
    expect((await stats.overview(site.id, query)).sessions.value).toBe(1)
    expect(await stats.timeseries(site.id, { ...query, interval: 'day' })).toHaveLength(1)
    expect(await stats.breakdown(site.id, 'page', query, { limit: 1 })).toHaveLength(1)
    expect((await stats.realtime(site.id)).online).toBe(1)
    expect((await stats.sessions(site.id, query)).items).toHaveLength(1)
    expect(await stats.session(site.id, 'nope')).toBeNull()
    expect((await stats.events(site.id, query, { type: 'goal' })).items).toHaveLength(1)
    expect((await stats.payments(site.id, query)).items).toHaveLength(3)
    expect(await stats.funnel(site.id, 'nope', query)).toBeNull()
    const [funnel] = await stats
      .funnel(site.id, 'nope', query)
      .then(() => server.adminJson<Funnel[]>(`/sites/${site.id}/funnels`))
    expect((await stats.funnel(site.id, funnel?.id ?? '', query))?.steps[0]?.visitors).toBe(1)
    await expect(stats.overview('missing', query)).rejects.toThrow('site not found')
    await expect(stats.overview(site.id, { from: 2, to: 1 })).rejects.toThrow('from must be before to')
    await expect(stats.overview(site.id, { ...query, tz: 'Nowhere' })).rejects.toThrow('tz must be')
    // @ts-expect-error unknown dimension
    await expect(stats.breakdown(site.id, 'planet', query)).rejects.toThrow('unknown dimension')
    expect(JSON.parse(await stats.export(site.id, 'json'))).toHaveProperty('events')
    // @ts-expect-error unknown table
    await expect(stats.export(site.id, 'csv', 'sites')).rejects.toThrow('unknown export')
    await expect(stats.purge(site.id, Number.NaN)).rejects.toThrow('before must be')
  })

  it('export: JSON backup and CSV tables, defusing spreadsheet formulas', async () => {
    const json = await server.admin(`/sites/${site.id}/export?format=json`)
    expect(json.headers.get('content-disposition')).toMatch(/attachment; filename="analytik-.+\.json"/)
    const backup = (await json.json()) as Record<string, unknown[]> & { site: Site }
    expect(backup.site.id).toBe(site.id)
    expect([backup.sessions?.length, backup.events?.length, backup.payments?.length, backup.funnels?.length]).toEqual([
      5, 8, 3, 1,
    ])
    expect(JSON.stringify(backup)).not.toContain('api_key_hash')

    await server.storage.run("UPDATE events SET name = '=HYPERLINK(\"x\")' WHERE type = 'goal'")
    const csv = await server.admin(`/sites/${site.id}/export?format=csv&table=events`)
    expect(csv.headers.get('content-type')).toContain('text/csv')
    const text = await csv.text()
    expect(text.split('\n')[0]).toBe('id,site_id,session_id,visitor_id,ts,type,name,path,props')
    expect(text).toContain(`"'=HYPERLINK(""x"")"`)
    expect(text).toContain('"{""plan"":""pro""}"')
    for (const table of ['visitors', 'sessions', 'payments']) {
      expect((await server.admin(`/sites/${site.id}/export?format=csv&table=${table}`)).status).toBe(200)
    }
    expect((await server.admin(`/sites/${site.id}/export?format=xml`)).status).toBe(400)
    expect(await server.analytik.stats.export(site.id, 'csv', 'visitors')).toContain('first_seen')
  })

  it('purge: deletes data before a date and keeps payments', async () => {
    expect((await server.admin(`/sites/${site.id}/data?before=soon`, { method: 'DELETE' })).status).toBe(400)
    const result = await server.adminJson(`/sites/${site.id}/data?before=2026-03-16`, { method: 'DELETE' })
    expect(result).toEqual({ events: 1, sessions: 1, visitors: 1 })
    expect(await server.adminJson(`/sites/${site.id}/data?before=${DAY_START}`, { method: 'DELETE' })).toEqual({
      events: 0,
      sessions: 0,
      visitors: 0,
    })
    expect(await server.analytik.stats.purge(site.id, START - 2 * DAY)).toEqual({ events: 0, sessions: 0, visitors: 0 })
    expect(await server.rows('SELECT COUNT(*) AS n FROM payments')).toEqual([{ n: 3 }])
  })
})

describe('empty sites', () => {
  it('return zeros, empty pages and an empty CSV', async () => {
    const server = await testServer()
    const { site } = await server.createSite()
    const overview = await server.adminJson<Overview>(`/sites/${site.id}/overview`)
    expect(overview.visitors).toEqual({ value: 0, previous: 0, change: null })
    expect(overview.bounceRate.value).toBe(0)
    const series = await server.adminJson<TimeseriesPoint[]>(
      `/sites/${site.id}/timeseries?from=2026-01-01&to=2026-03-16&interval=hour`,
    )
    // 75 days of hours is too many points; the interval falls back to days.
    expect(series).toHaveLength(75)
    expect(await server.adminJson(`/sites/${site.id}/sessions`)).toEqual({ items: [], nextCursor: null, total: 0 })
    expect(await (await server.admin(`/sites/${site.id}/export?format=csv`)).text()).toBe('')
    await server.close()
  })
})
