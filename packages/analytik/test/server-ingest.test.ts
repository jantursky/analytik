import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DAY, MINUTE } from '../src/shared/time'
import type { Site } from '../src/shared/types'
import { CHROME, IPHONE, START, type TestServer, testServer } from './helpers/server'

let server: TestServer
let site: Site

const page = (path = '/', extra: Record<string, unknown> = {}) => ({
  t: 'pageview',
  u: `https://example.com${path}`,
  ...extra,
})

beforeEach(async () => {
  server = await testServer()
  site = (await server.createSite()).site
})

afterEach(async () => {
  await server.close()
})

const sessions = () => server.rows('SELECT * FROM sessions ORDER BY started_at, id')
const events = () => server.rows('SELECT * FROM events ORDER BY ts, id')

describe('POST /event in strict mode', () => {
  it('accepts a pageview and stores the visit without anything from the device', async () => {
    const response = await server.event({ w: site.id, ...page('/pricing/?utm_source=x&email=a@b.c#top') })
    expect(response.status).toBe(202)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    const [session] = await sessions()
    expect(session).toMatchObject({
      site_id: site.id,
      entry_page: '/pricing',
      exit_page: '/pricing',
      pageviews: 1,
      source: 'X',
      channel: 'Organic Social',
      utm_source: 'x',
      browser: 'Chrome',
      os: 'Mac OS',
      device: 'Desktop',
      hostname: 'example.com',
    })
    expect(String(session?.visitor_id)).toMatch(/^[0-9a-f]{32}$/)
    expect(await events()).toMatchObject([{ type: 'pageview', path: '/pricing', name: null }])
  })

  it('derives the same visitor from IP and user agent and keeps one session within 30 minutes', async () => {
    await server.event({ w: site.id, ...page('/') })
    server.advance(29 * MINUTE)
    await server.event({ w: site.id, ...page('/docs') })
    server.advance(31 * MINUTE)
    await server.event({ w: site.id, ...page('/blog') })
    await server.event({ w: site.id, ...page('/') }, { 'user-agent': IPHONE })

    const rows = await sessions()
    expect(rows).toHaveLength(3)
    const desktop = rows.filter((row) => row.device === 'Desktop')
    const phone = rows.find((row) => row.device === 'Mobile')
    expect(desktop[0]).toMatchObject({ pageviews: 2, entry_page: '/', exit_page: '/docs' })
    expect(desktop[0]?.visitor_id).toBe(desktop[1]?.visitor_id)
    expect(phone).toMatchObject({ os: 'iOS' })
    expect(phone?.visitor_id).not.toBe(desktop[0]?.visitor_id)
  })

  it('rotates the salt each UTC month and deletes the old one', async () => {
    await server.event({ w: site.id, ...page('/') })
    const [first] = await server.rows<{ month: string }>('SELECT month FROM salts')
    expect(first?.month).toBe('2026-03')
    server.now = Date.UTC(2026, 3, 1, 0, 5)
    await server.event({ w: site.id, ...page('/') })
    expect(await server.rows('SELECT month FROM salts')).toEqual([{ month: '2026-04' }])
    const rows = await sessions()
    expect(rows[0]?.visitor_id).not.toBe(rows[1]?.visitor_id)
  })

  it('ignores identify without consent and ignores client-sent ids', async () => {
    await server.event({ w: site.id, ...page('/'), vid: 'client-visitor-1', sid: 'client-session-1' })
    await server.event({ w: site.id, t: 'identify', u: 'https://example.com/', p: { email: 'Ann@Example.com' } })
    const [session] = await sessions()
    expect(session?.visitor_id).not.toBe('client-visitor-1')
    expect(await server.rows('SELECT email FROM visitors')).toEqual([{ email: null }])
  })

  it('records goals with clean props, outbound clicks and engagement pings', async () => {
    await server.event({ w: site.id, ...page('/') })
    await server.event({
      w: site.id,
      t: 'goal',
      u: 'https://example.com/',
      n: 'signup',
      p: { plan: 'pro', seats: 3, trial: true, nested: { no: 1 }, empty: null },
    })
    await server.event({ w: site.id, t: 'outbound', u: 'https://example.com/', n: 'https://github.com/x' })
    await server.event({ w: site.id, t: 'ping', u: 'https://example.com/', d: 12_345 })
    await server.event({ w: site.id, t: 'ping', u: 'https://example.com/', d: 99 * MINUTE })

    const rows = await events()
    expect(rows.map((row) => [row.type, row.name])).toEqual([
      ['pageview', null],
      ['goal', 'signup'],
      ['outbound', 'https://github.com/x'],
    ])
    expect(JSON.parse(String(rows[1]?.props))).toEqual({ plan: 'pro', seats: 3, trial: true, empty: null })
    const [session] = await sessions()
    expect(session).toMatchObject({ goals: 1, duration: 12_345 + 10 * MINUTE })
  })

  it('requires a name for goals and outbound clicks', async () => {
    expect((await server.event({ w: site.id, t: 'goal', u: 'https://example.com/' })).status).toBe(400)
    expect((await server.event({ w: site.id, t: 'outbound', u: 'https://example.com/', n: ' ' })).status).toBe(400)
  })

  it('stores revenue events as client payments, once per order id', async () => {
    await server.event({ w: site.id, ...page('/checkout') })
    const revenue = {
      w: site.id,
      t: 'revenue',
      u: 'https://example.com/thanks',
      n: 'purchase',
      a: 29.99,
      c: 'eur',
      o: 'order-1',
    }
    expect((await server.event(revenue)).status).toBe(202)
    expect((await server.event(revenue)).status).toBe(202)
    const payments = await server.rows(
      'SELECT id, order_id, provider, amount, currency, matched_by, kind FROM payments',
    )
    expect(payments).toEqual([
      {
        id: 'client:order-1',
        order_id: 'order-1',
        provider: 'client',
        amount: 2999,
        currency: 'EUR',
        matched_by: 'metadata',
        kind: 'payment',
      },
    ])
    expect((await server.event({ ...revenue, a: -1 })).status).toBe(400)
  })

  it('uses the site currency for revenue without one and makes up an id without an order', async () => {
    await server.event({ w: site.id, t: 'revenue', u: 'https://example.com/', a: 10, c: 'not-a-code' })
    expect(await server.rows('SELECT amount, currency FROM payments')).toEqual([{ amount: 1000, currency: 'USD' }])
  })

  it('reads location from Vercel headers, then Cloudflare', async () => {
    await server.event(
      { w: site.id, ...page('/') },
      {
        'x-vercel-ip-country': 'DE',
        'x-vercel-ip-country-region': 'BE',
        'x-vercel-ip-city': 'Berlin%20Mitte',
        'x-vercel-ip-latitude': '52.520008',
        'x-vercel-ip-longitude': '13.404954',
      },
    )
    await server.event({ w: site.id, ...page('/') }, { 'user-agent': IPHONE, 'cf-ipcountry': 'FR' })
    await server.event({ w: site.id, ...page('/') }, { 'user-agent': `${IPHONE} x`, 'cf-ipcountry': 'XX' })
    const rows = await server.rows('SELECT country, region, city, lat, lon FROM sessions ORDER BY started_at, id')
    expect(rows).toContainEqual({ country: 'DE', region: 'BE', city: 'Berlin Mitte', lat: 52.52, lon: 13.4 })
    expect(rows).toContainEqual({ country: 'FR', region: null, city: null, lat: null, lon: null })
    expect(rows).toContainEqual({ country: null, region: null, city: null, lat: null, lon: null })
  })

  it('classifies referrers and ignores navigation inside the site', async () => {
    await server.event({ w: site.id, ...page('/'), r: 'https://www.google.com/search?q=x' })
    await server.event({ w: site.id, ...page('/'), r: 'https://blog.example.com/post' }, { 'user-agent': IPHONE })
    await server.event({ w: site.id, ...page('/'), r: 'android-app://com.google.android.gm/' }, { 'user-agent': 'x' })
    const rows = await server.rows(
      'SELECT source, channel, referrer, referrer_domain FROM sessions ORDER BY started_at, id',
    )
    expect(rows).toContainEqual({
      source: 'Google',
      channel: 'Organic Search',
      referrer: 'google.com/search',
      referrer_domain: 'google.com',
    })
    expect(rows).toContainEqual({ source: 'Direct/None', channel: 'Direct', referrer: null, referrer_domain: null })
    expect(rows).toContainEqual({
      source: 'Gmail',
      channel: 'Email',
      referrer: null,
      referrer_domain: 'com.google.android.gm',
    })
  })
})

describe('POST /event filtering and validation', () => {
  it('answers 202 for bots without storing anything', async () => {
    const response = await server.event({ w: site.id, ...page('/') }, { 'user-agent': 'Googlebot/2.1' })
    expect(response.status).toBe(202)
    expect(await sessions()).toEqual([])
  })

  it('drops events from ignored IPs', async () => {
    await server.admin(`/sites/${site.id}`, { method: 'PATCH', json: { ignoredIps: ['203.0.113.7'] } })
    expect((await server.event({ w: site.id, ...page('/') })).status).toBe(202)
    expect(await sessions()).toEqual([])
  })

  it('rejects bad payloads', async () => {
    const bad = async (body: string) => (await server.request('/event', { method: 'POST', body })).status
    expect(await bad('not json')).toBe(400)
    expect(await bad('[]')).toBe(400)
    expect(await bad(JSON.stringify({ w: 'bad id!', t: 'pageview', u: 'https://example.com' }))).toBe(400)
    expect(await bad(JSON.stringify({ w: site.id, t: 'nope', u: 'https://example.com' }))).toBe(400)
    expect(await bad(JSON.stringify({ w: site.id, t: 'pageview' }))).toBe(400)
    expect(await bad(JSON.stringify({ w: site.id, t: 'pageview', u: 'not a url' }))).toBe(400)
    expect(await bad(JSON.stringify({ w: site.id, t: 'pageview', u: 'ftp://example.com/' }))).toBe(400)
  })

  it('refuses bodies over 8 KB with 413', async () => {
    const big = JSON.stringify({ w: site.id, ...page('/'), p: { x: 'y'.repeat(9000) } })
    expect((await server.request('/event', { method: 'POST', body: big })).status).toBe(413)
    const declared = await server.request('/event', {
      method: 'POST',
      body: '{}',
      headers: { 'content-length': '9000' },
    })
    expect(declared.status).toBe(413)
  })

  it('answers 404 for unknown sites', async () => {
    expect((await server.event({ w: 'unknown-site', ...page('/') })).status).toBe(404)
  })

  it('only accepts pages and origins on the site domain', async () => {
    expect((await server.event({ w: site.id, t: 'pageview', u: 'https://evil.com/' })).status).toBe(403)
    expect((await server.event({ w: site.id, ...page('/') }, { origin: 'https://evil.com' })).status).toBe(403)
    expect((await server.event({ w: site.id, ...page('/') }, { origin: 'null' })).status).toBe(403)
    expect(
      (
        await server.event(
          { w: site.id, t: 'pageview', u: 'https://shop.example.com/' },
          { origin: 'https://shop.example.com' },
        )
      ).status,
    ).toBe(202)
    const local = { w: site.id, t: 'pageview', u: 'http://localhost:3000/' }
    expect((await server.event(local, { origin: 'http://localhost:3000' })).status).toBe(403)
    await server.admin(`/sites/${site.id}`, { method: 'PATCH', json: { allowLocalhost: true } })
    expect((await server.event(local, { origin: 'http://localhost:3000' })).status).toBe(202)
  })

  it('honours the allowedOrigins option', async () => {
    const listed = await testServer('memory', { allowedOrigins: ['preview.dev'] })
    const any = await testServer('memory', { allowedOrigins: 'any' })
    for (const instance of [listed, any]) {
      const { site: other } = await instance.createSite()
      const response = await instance.event(
        { w: other.id, t: 'pageview', u: 'https://pr-1.preview.dev/' },
        { origin: 'https://pr-1.preview.dev' },
      )
      expect(response.status).toBe(202)
      await instance.close()
    }
  })
})

describe('POST /event in persistent and enriched modes', () => {
  it('uses the tracker ids in persistent mode and requires them', async () => {
    await server.admin(`/sites/${site.id}`, { method: 'PATCH', json: { privacyMode: 'persistent' } })
    const ids = { m: 'persistent', vid: 'visitor-0001', sid: 'session-0001' } as const
    expect((await server.event({ w: site.id, ...page('/'), ...ids })).status).toBe(202)
    expect((await server.event({ w: site.id, ...page('/'), m: 'persistent' })).status).toBe(400)
    await server.event({
      w: site.id,
      t: 'identify',
      u: 'https://example.com/',
      ...ids,
      p: { email: 'Ann@Example.com', name: 'Ann', userId: 'u1' },
    })
    await server.event({ w: site.id, t: 'ping', u: 'https://example.com/', ...ids, d: 5000 })
    expect(await sessions()).toMatchObject([{ id: 'session-0001', visitor_id: 'visitor-0001', duration: 5000 }])
    expect(await server.rows('SELECT email, name, user_id FROM visitors')).toEqual([
      { email: 'ann@example.com', name: 'Ann', user_id: 'u1' },
    ])
  })

  it('downgrades to strict for Do Not Track and Global Privacy Control', async () => {
    await server.admin(`/sites/${site.id}`, { method: 'PATCH', json: { privacyMode: 'persistent' } })
    await server.event(
      { w: site.id, ...page('/'), m: 'persistent', vid: 'visitor-0001', sid: 'session-0001' },
      { dnt: '1' },
    )
    await server.event(
      { w: site.id, ...page('/'), m: 'persistent', vid: 'visitor-0002', sid: 'session-0002' },
      { 'sec-gpc': '1', 'user-agent': IPHONE },
    )
    const rows = await sessions()
    expect(rows.map((row) => row.visitor_id)).not.toContain('visitor-0001')
    expect(rows.map((row) => row.visitor_id)).not.toContain('visitor-0002')
  })

  it('treats an event without m as strict, even with ids', async () => {
    await server.admin(`/sites/${site.id}`, { method: 'PATCH', json: { privacyMode: 'persistent' } })
    await server.event({ w: site.id, ...page('/'), vid: 'visitor-0001', sid: 'session-0001' })
    expect((await sessions())[0]?.visitor_id).not.toBe('visitor-0001')
  })

  it('never goes beyond the site mode, whatever the tracker asks for', async () => {
    await server.event({ w: site.id, ...page('/'), vid: 'visitor-0001', sid: 'session-0001', m: 'persistent' })
    expect((await sessions())[0]?.visitor_id).not.toBe('visitor-0001')
  })

  it('combines the server hash with the tab id in enriched mode', async () => {
    await server.admin(`/sites/${site.id}`, { method: 'PATCH', json: { privacyMode: 'enriched' } })
    await server.event({ w: site.id, ...page('/'), sid: 'tab-000001', m: 'enriched' })
    await server.event({ w: site.id, ...page('/two'), sid: 'tab-000002', m: 'enriched' })
    await server.event({
      w: site.id,
      t: 'identify',
      u: 'https://example.com/',
      sid: 'tab-000002',
      m: 'enriched',
      p: { email: 'x@y.z' },
    })
    const rows = await sessions()
    expect(rows.map((row) => row.id)).toEqual(['tab-000001', 'tab-000002'])
    expect(rows[0]?.visitor_id).toBe(rows[1]?.visitor_id)
    expect(await server.rows('SELECT email FROM visitors')).toEqual([{ email: 'x@y.z' }])
  })

  it('opens a server session in enriched mode when the tab id is missing', async () => {
    await server.admin(`/sites/${site.id}`, { method: 'PATCH', json: { privacyMode: 'enriched' } })
    await server.event({ w: site.id, ...page('/'), m: 'enriched' })
    expect(await sessions()).toHaveLength(1)
  })
})

describe('page paths and retention', () => {
  it('keeps only the configured query keys and never private ones', async () => {
    const custom = await testServer('memory', { privacy: { keepQuery: ['q', 'Email'] } })
    const { site: other } = await custom.createSite()
    await custom.event({ w: other.id, t: 'pageview', u: 'https://example.com/search/?q=shoes&email=a@b.c&page=2' })
    expect(await custom.rows('SELECT path FROM events')).toEqual([{ path: '/search?q=shoes' }])
    await custom.close()
  })

  it('purges data older than the retention period while collecting', async () => {
    await server.admin(`/sites/${site.id}`, { method: 'PATCH', json: { retentionDays: 30 } })
    await server.event({ w: site.id, ...page('/old') })
    server.advance(31 * DAY)
    await server.event({ w: site.id, ...page('/new') })
    expect((await events()).map((row) => row.path)).toEqual(['/new'])
    expect(await sessions()).toHaveLength(1)
    // Enforced at most hourly per instance: a minute later nothing runs, a month later it does.
    await server.storage.run('UPDATE events SET ts = ?', [START])
    server.advance(MINUTE)
    await server.event({ w: site.id, ...page('/later') }, { 'user-agent': IPHONE })
    expect(await events()).toHaveLength(2)
    server.advance(31 * DAY)
    await server.event({ w: site.id, ...page('/newer') }, { 'user-agent': CHROME })
    expect((await events()).map((row) => row.path)).toEqual(['/newer'])
  })

  it('exposes ingest() for server code with the same validation', async () => {
    const result = await server.analytik.ingest({
      payload: { w: site.id, ...page('/ssr') },
      ip: '198.51.100.1',
      userAgent: CHROME,
    })
    expect(result).toMatchObject({ status: 202 })
    expect(await server.analytik.ingest({ payload: null })).toEqual({ status: 400, error: 'payload must be an object' })
    expect(await server.analytik.ingest({ payload: { w: site.id, ...page('/') } })).toMatchObject({ filtered: 'bot' })
  })
})
