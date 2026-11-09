import { afterEach, describe, expect, it, vi } from 'vitest'

import { createIngestLimiter, LIMIT_ENTRIES } from '../src/server/ingest-limit'
import { MINUTE } from '../src/shared/time'
import { storageKinds } from './helpers/databases'
import { type TestServer, testServer } from './helpers/server'

describe('ingest limiter', () => {
  it('counts per key, answers with the seconds left and starts a new window after a minute', () => {
    const limiter = createIngestLimiter()
    expect(limiter.hit('a', 2, 1000)).toBeNull()
    expect(limiter.hit('a', 2, 1001)).toBeNull()
    expect(limiter.hit('a', 2, 1002)).toBe(60)
    expect(limiter.hit('a', 2, 1000 + 30_000)).toBe(30)
    // Never less than one second.
    expect(limiter.hit('a', 2, 1000 + MINUTE - 1)).toBe(1)
    expect(limiter.hit('b', 2, 1002)).toBeNull()
    expect(limiter.hit('a', 2, 1000 + MINUTE)).toBeNull()
  })

  it('stays at its cap and keeps counting the newest clients', () => {
    const limiter = createIngestLimiter()
    for (let i = 0; i < LIMIT_ENTRIES + 50; i++) limiter.hit(`k${i}`, 5, 1000)
    expect(limiter.size).toBe(LIMIT_ENTRIES)
    // The newest key is still counted, the oldest was dropped.
    for (let i = 0; i < 5; i++) limiter.hit('newest', 5, 1000)
    expect(limiter.hit('newest', 5, 1000)).not.toBeNull()
  })

  it('sweeps expired windows before dropping live ones', () => {
    const limiter = createIngestLimiter()
    for (let i = 0; i < LIMIT_ENTRIES; i++) limiter.hit(`old${i}`, 5, 1000)
    limiter.hit('live', 5, 1000 + MINUTE)
    expect(limiter.size).toBe(1)
  })
})

describe.each(storageKinds())('event rate limit on %s', (kind) => {
  let server: TestServer
  afterEach(() => server.close())

  const page = (id: string, host = 'example.com') => ({ w: id, t: 'pageview', u: `https://${host}/` })
  const count = async () => (await server.rows<{ n: number }>('SELECT COUNT(*) AS n FROM events'))[0]?.n

  it('refuses the 301st event of one client in a minute and writes nothing for it', async () => {
    server = await testServer(kind)
    const { site } = await server.createSite()
    for (let i = 0; i < 300; i++) expect((await server.event(page(site.id))).status).toBe(202)
    const limited = await server.event(page(site.id))
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toMatch(/^\d+$/)
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThanOrEqual(1)
    expect(await limited.json()).toEqual({ error: 'too many requests' })
    expect(await count()).toBe(300)
    expect(await server.rows('SELECT * FROM rate_limits')).toEqual([])
    // Another address is unaffected, and the next minute starts fresh.
    expect((await server.event(page(site.id), { 'cf-connecting-ip': '203.0.113.99' })).status).toBe(202)
    server.advance(MINUTE)
    expect((await server.event(page(site.id))).status).toBe(202)
  })

  it('counts each site apart', async () => {
    server = await testServer(kind, { rateLimit: { perClient: 2 } })
    const { site } = await server.createSite()
    const { site: other } = await server.createSite({ domain: 'other.example.com' })
    await server.event(page(site.id))
    await server.event(page(site.id))
    expect((await server.event(page(site.id))).status).toBe(429)
    expect(
      (await server.event(page(other.id, 'other.example.com'), { origin: 'https://other.example.com' })).status,
    ).toBe(202)
  })

  it('does not limit clients whose address is unknown', async () => {
    server = await testServer(kind, { rateLimit: { perClient: 1 }, clientIp: () => null })
    const { site } = await server.createSite()
    for (let i = 0; i < 5; i++) expect((await server.event(page(site.id))).status).toBe(202)
  })

  it('limits a whole site when perSite is set, whoever sends', async () => {
    server = await testServer(kind, { rateLimit: { perClient: false, perSite: 3 } })
    const { site } = await server.createSite()
    for (let i = 0; i < 3; i++) await server.event(page(site.id), { 'cf-connecting-ip': `203.0.113.${i + 10}` })
    expect((await server.event(page(site.id), { 'cf-connecting-ip': '203.0.113.50' })).status).toBe(429)
  })

  it('can be switched off', async () => {
    server = await testServer(kind, { rateLimit: { perClient: false, perSite: false } })
    const { site } = await server.createSite()
    for (let i = 0; i < 320; i++) expect((await server.event(page(site.id))).status).toBe(202)
  })

  it('answers 400 for a payload without a site before anything is counted against a real one', async () => {
    server = await testServer(kind, { rateLimit: { perClient: 1 } })
    expect((await server.event({ t: 'pageview' })).status).toBe(400)
    expect((await server.event({ t: 'pageview' })).status).toBe(429)
  })
})

describe('retention off the request path', () => {
  const DAY = 86_400_000
  let server: TestServer
  afterEach(() => {
    vi.restoreAllMocks()
    return server.close()
  })
  const page = (id: string, path: string) => ({ w: id, t: 'pageview', u: `https://example.com${path}` })

  it('hands the purge to defer without waiting for it', async () => {
    server = await testServer('memory')
    const { site } = await server.createSite()
    await server.adminJson(`/sites/${site.id}`, { method: 'PATCH', json: { retentionDays: 30 } })
    await server.event(page(site.id, '/old'))
    server.advance(31 * DAY)
    const deferred: Promise<unknown>[] = []
    const result = await server.analytik.ingest({
      payload: page(site.id, '/new'),
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/141.0.0.0 Safari/537.36',
      origin: 'https://example.com',
      defer: (work) => deferred.push(work),
    })
    expect(result).toMatchObject({ status: 202 })
    expect(deferred).toHaveLength(1)
    await deferred[0]
    expect((await server.rows('SELECT path FROM events')).map((row) => (row as { path: string }).path)).toEqual([
      '/new',
    ])
  })

  it('still awaits the purge when no defer is given', async () => {
    server = await testServer('memory')
    const { site } = await server.createSite()
    await server.adminJson(`/sites/${site.id}`, { method: 'PATCH', json: { retentionDays: 30 } })
    await server.event(page(site.id, '/old'))
    server.advance(31 * DAY)
    await server.analytik.ingest({
      payload: page(site.id, '/new'),
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/141.0.0.0 Safari/537.36',
      origin: 'https://example.com',
    })
    expect(await server.rows('SELECT path FROM events')).toEqual([{ path: '/new' }])
  })

  it('stores the event and logs when the background purge fails', async () => {
    server = await testServer('memory')
    const { site } = await server.createSite()
    await server.adminJson(`/sites/${site.id}`, { method: 'PATCH', json: { retentionDays: 30 } })
    server.advance(31 * DAY)
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const run = server.storage.run.bind(server.storage)
    vi.spyOn(server.storage, 'run').mockImplementation((sql, params) =>
      sql.startsWith('DELETE FROM events') ? Promise.reject(new Error('purge broke')) : run(sql, params),
    )
    expect((await server.event(page(site.id, '/new'))).status).toBe(202)
    await vi.waitFor(() => expect(log).toHaveBeenCalled())
    expect(await server.rows('SELECT path FROM events')).toEqual([{ path: '/new' }])
  })
})
