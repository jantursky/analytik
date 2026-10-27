import { afterEach, describe, expect, it, vi } from 'vitest'

import { createAnalytik } from '../src/server'
import { clientIpFrom } from '../src/server/request'
import { DAY } from '../src/shared/time'
import type { Overview, Page, SessionSummary } from '../src/shared/types'
import { memoryStorage } from '../src/storage/memory'
import { storageKinds } from './helpers/databases'
import { CHROME, PASSWORD, SECRET, START, type TestServer, testServer } from './helpers/server'

const RANGE = 'from=2026-03-16&to=2026-03-16&tz=UTC'

let server: TestServer | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
})

describe('admin configuration', () => {
  it('refuses to start with an empty password or a short secret', () => {
    const create = (admin: { password: string; secret: string }) => () =>
      createAnalytik({ storage: memoryStorage(), admin })
    expect(create({ password: '', secret: SECRET })).toThrow('admin.password is empty')
    // Missing environment variables arrive as undefined despite the types.
    expect(create({ password: undefined as unknown as string, secret: SECRET })).toThrow('admin.password is empty')
    expect(create({ password: PASSWORD, secret: '' })).toThrow('at least 32 characters')
    expect(create({ password: PASSWORD, secret: 'x'.repeat(31) })).toThrow('at least 32 characters')
    expect(create({ password: PASSWORD, secret: 'x'.repeat(32) })).not.toThrow()
  })
})

describe('client IP', () => {
  const request = (headers: Record<string, string>, cf?: object) => {
    const value = new Request('https://analytics.example.com/api/event', { headers })
    if (cf) Object.defineProperty(value, 'cf', { value: cf })
    return value
  }
  const spoofed = { 'x-forwarded-for': '198.51.100.1', 'x-real-ip': '198.51.100.2', 'cf-connecting-ip': '198.51.100.3' }

  it('trusts only the platform the request came through', () => {
    expect(clientIpFrom(request(spoofed), 'auto')).toBeNull()
    expect(clientIpFrom(request(spoofed, { country: 'DE' }), 'auto')).toBe('198.51.100.3')
    const vercel = { ...spoofed, 'x-vercel-id': 'fra1::abc', 'x-vercel-forwarded-for': '203.0.113.5, 10.0.0.1' }
    expect(clientIpFrom(request(vercel), 'auto')).toBeNull()
    vi.stubEnv('VERCEL', '1')
    expect(clientIpFrom(request(vercel), 'auto')).toBe('203.0.113.5')
    vi.unstubAllEnvs()
    expect(clientIpFrom(request({ 'x-real-ip': '203.0.113.6' }), 'vercel')).toBe('203.0.113.6')
    expect(clientIpFrom(request(spoofed), 'cloudflare')).toBe('198.51.100.3')
    expect(clientIpFrom(request({ 'cf-connecting-ip': 'not an ip' }), 'cloudflare')).toBeNull()
    expect(clientIpFrom(request(spoofed, { country: 'DE' }), false)).toBeNull()
  })

  it('reads the rightmost public address of X-Forwarded-For in forwarded mode', () => {
    const forwarded = (value: string) => clientIpFrom(request({ 'x-forwarded-for': value }), 'forwarded')
    expect(forwarded('1.1.1.1, 203.0.113.9')).toBe('203.0.113.9')
    expect(forwarded('1.1.1.1, 203.0.113.9, 10.0.0.2, 192.168.1.1')).toBe('203.0.113.9')
    expect(forwarded('2001:db8::1, fd00::1')).toBe('2001:db8::1')
    expect(forwarded('10.0.0.2')).toBe('10.0.0.2')
    expect(forwarded('garbage, <script>')).toBeNull()
    expect(clientIpFrom(request({}), 'forwarded')).toBeNull()
  })

  it('locks out a password guesser who rotates X-Forwarded-For', async () => {
    server = await testServer('memory', { trustProxy: 'auto' })
    const login = (index: number) =>
      server!.request('/auth/login', {
        method: 'POST',
        headers: { 'x-forwarded-for': `10.0.${index}.1`, 'x-real-ip': `10.1.${index}.1` },
        body: JSON.stringify({ password: 'guess' }),
      })
    const statuses: number[] = []
    for (let index = 0; index < 12; index++) statuses.push((await login(index)).status)
    expect(statuses).toEqual([...Array<number>(10).fill(401), 429, 429])
  })

  it('applies ignored IPs and a custom clientIp() lookup', async () => {
    server = await testServer('memory', { clientIp: (request) => request.headers.get('x-test-ip') })
    const { site } = await server.createSite({ ignoredIps: ['192.0.2.50'] })
    const page = { w: site.id, t: 'pageview', u: 'https://example.com/' }
    await server.event(page, { 'x-test-ip': '192.0.2.50' })
    expect(await server.rows('SELECT id FROM sessions')).toEqual([])
    await server.event(page, { 'x-test-ip': '192.0.2.51' })
    // Without an IP, strict visitors are told apart by user agent only.
    await server.event(page, { 'cf-connecting-ip': '192.0.2.50' })
    expect(await server.rows('SELECT id FROM sessions')).toHaveLength(2)
  })
})

describe('share links', () => {
  it('read aggregates and the session list, never payments or session details', async () => {
    server = await testServer()
    const { site, apiKey } = await server.createSite({ shareToken: true, privacyMode: 'persistent' })
    const token = site.shareToken ?? ''
    await server.event({
      w: site.id,
      t: 'pageview',
      u: 'https://example.com/',
      m: 'persistent',
      vid: 'visitor-0001',
      sid: 'session-0001',
    })
    await server.event({
      w: site.id,
      t: 'identify',
      u: 'https://example.com/',
      m: 'persistent',
      vid: 'visitor-0001',
      sid: 'session-0001',
      p: { email: 'ann@example.com', name: 'Ann' },
    })
    await server.request('/v1/payments', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ id: 'p_1', amount: 500, currency: 'USD', email: 'ann@example.com', name: 'Ann' }),
    })
    const shared = (path: string) =>
      server!.request(`/sites/${site.id}${path}${path.includes('?') ? '&' : '?'}share=${token}`)
    expect((await shared(`/payments?${RANGE}`)).status).toBe(401)
    expect((await shared('/sessions/session-0001')).status).toBe(401)
    const sessions = await shared(`/sessions?${RANGE}`)
    expect(sessions.status).toBe(200)
    const text = await sessions.text()
    expect((JSON.parse(text) as Page<SessionSummary>).items).toHaveLength(1)
    expect(text).not.toMatch(/ann@example\.com|"Ann"|email/)
  })
})

describe('month salts', () => {
  it('survive an instance whose clock lags into the previous month', async () => {
    const storage = memoryStorage()
    const options = { storage, admin: { password: PASSWORD, secret: SECRET } }
    const november = Date.UTC(2026, 10, 1, 0, 0, 5)
    const ahead = createAnalytik({ ...options, now: () => november })
    const behind = createAnalytik({ ...options, now: () => november - 10_000 })
    const event = (analytik: typeof ahead) =>
      analytik.ingest({
        payload: { w: 'site-00001', t: 'pageview', u: 'https://example.com/' },
        ip: '192.0.2.1',
        userAgent: CHROME,
      })
    await storage.migrate()
    await storage.run(
      "INSERT INTO sites (id, name, domain, api_key_hash, created_at) VALUES ('site-00001', 'x', 'example.com', 'h', 0)",
    )
    const first = await event(ahead)
    const salt = await storage.query<{ month: string }>('SELECT month, value FROM salts')
    expect(salt.map((row) => row.month)).toEqual(['2026-11'])
    await event(behind)
    expect(await storage.query("SELECT month, value FROM salts WHERE month = '2026-11'")).toEqual(salt)
    // A fresh instance on the right clock still links the visitor.
    const again = createAnalytik({ ...options, now: () => november + 1000 })
    expect(await event(again)).toMatchObject({ visitorId: (first as { visitorId: string }).visitorId })
  })
})

describe.each(storageKinds())('stats on %s', (kind) => {
  async function setup() {
    server = await testServer(kind)
    const created = await server.createSite({ privacyMode: 'persistent', currency: 'EUR' })
    return created
  }

  const pay = (apiKey: string, body: Record<string, unknown>) =>
    server!.request('/v1/payments', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ ts: START, ...body }),
    })

  it('adds up revenue in the site currency only and lists the others', async () => {
    const { site, apiKey } = await setup()
    await server!.event({
      w: site.id,
      t: 'pageview',
      u: 'https://example.com/',
      m: 'persistent',
      vid: 'visitor-0001',
      sid: 'session-0001',
    })
    const visitor = { visitorId: 'visitor-0001' }
    await pay(apiKey, { id: 'eur_1', amount: 2000, currency: 'EUR', ...visitor })
    await pay(apiKey, { id: 'jpy_1', amount: 10_000, currency: 'JPY', ...visitor })
    await pay(apiKey, { id: 'usd_1', amount: 1500, currency: 'USD', ...visitor })
    await pay(apiKey, { id: 'usd_2', amount: 500, currency: 'USD', kind: 'refund', orderId: 'usd_1' })
    const get = <T>(path: string) => server!.adminJson<T>(`/sites/${site.id}${path}`)
    const overview = await get<Overview>(`/overview?${RANGE}`)
    expect([overview.revenue.value, overview.orders.value, overview.currency]).toEqual([2000, 1, 'EUR'])
    expect(overview.otherCurrencies).toEqual([
      { currency: 'JPY', amount: 10_000, orders: 1 },
      { currency: 'USD', amount: 1000, orders: 1 },
    ])
    const [day] = await get<{ revenue: number }[]>(`/timeseries?${RANGE}&interval=day`)
    expect(day?.revenue).toBe(2000)
    const [channel] = await get<{ revenue: number }[]>(`/breakdown?${RANGE}&dimension=channel`)
    expect(channel?.revenue).toBe(2000)
    const [page] = await get<{ revenue: number }[]>(`/breakdown?${RANGE}&dimension=page`)
    expect(page?.revenue).toBe(2000)
    const sessions = await get<Page<SessionSummary>>(`/sessions?${RANGE}`)
    expect(sessions.items[0]?.revenue).toBe(2000)
  })

  it('matches prefix filters case-sensitively', async () => {
    const { site } = await setup()
    const visit = (path: string, n: number) =>
      server!.event({
        w: site.id,
        t: 'pageview',
        u: `https://example.com${path}`,
        m: 'persistent',
        vid: `visitor-000${n}`,
        sid: `session-000${n}`,
      })
    await visit('/Blog/x', 1)
    await visit('/blog/y', 2)
    await visit('/blog_z', 3)
    const sessions = async (filter: string) =>
      (await server!.adminJson<Overview>(`/sites/${site.id}/overview?${RANGE}&${filter}`)).sessions.value
    expect(await sessions('page=/Blog*')).toBe(1)
    expect(await sessions('page=/blog/*')).toBe(1)
    // `_` and `%` are plain characters, not LIKE wildcards.
    expect(await sessions(`page=${encodeURIComponent('/blog_*')}`)).toBe(1)
    expect(await sessions(`page=${encodeURIComponent('/%*')}`)).toBe(0)
    expect(await sessions('entry=/b*')).toBe(2)
  })

  it('clears the personal fields of payments older than the retention cutoff', async () => {
    const { site, apiKey } = await setup()
    await server!.event({
      w: site.id,
      t: 'pageview',
      u: 'https://example.com/',
      m: 'persistent',
      vid: 'visitor-0001',
      sid: 'session-0001',
    })
    const person = { email: 'ann@example.com', name: 'Ann', customerId: 'cus_1', visitorId: 'visitor-0001' }
    await pay(apiKey, { id: 'old', amount: 1000, currency: 'EUR', ...person })
    await pay(apiKey, { id: 'new', amount: 2000, currency: 'EUR', ...person, ts: START + 2 * DAY })
    await server!.admin(`/sites/${site.id}/data?before=${START + DAY}`, { method: 'DELETE' })
    expect(
      await server!.rows(
        'SELECT id, amount, currency, provider, email, name, customer_id, visitor_id, session_id FROM payments ORDER BY id',
      ),
    ).toEqual([
      {
        id: 'new',
        amount: 2000,
        currency: 'EUR',
        provider: 'api',
        email: 'ann@example.com',
        name: 'Ann',
        customer_id: 'cus_1',
        visitor_id: 'visitor-0001',
        session_id: 'session-0001',
      },
      {
        id: 'old',
        amount: 1000,
        currency: 'EUR',
        provider: 'api',
        email: null,
        name: null,
        customer_id: null,
        visitor_id: null,
        session_id: null,
      },
    ])
    // Retention runs the same purge on ingest.
    await server!.admin(`/sites/${site.id}`, { method: 'PATCH', json: { retentionDays: 1 } })
    server!.now = START + 4 * DAY
    await server!.event({
      w: site.id,
      t: 'pageview',
      u: 'https://example.com/',
      m: 'persistent',
      vid: 'visitor-0002',
      sid: 'session-0002',
    })
    expect(await server!.rows("SELECT email, visitor_id FROM payments WHERE id = 'new'")).toEqual([
      { email: null, visitor_id: null },
    ])
  })
})
