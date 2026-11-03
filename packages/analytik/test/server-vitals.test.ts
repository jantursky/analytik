import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DAY } from '../src/shared/time'
import type { Site } from '../src/shared/types'
import { storageKinds } from './helpers/databases'
import { PASSWORD, type TestServer, testServer } from './helpers/server'

interface Row {
  site_id: string
  ts: number
  path: string
  lcp: number | null
  inp: number | null
  cls: number | null
}

describe.each(storageKinds())('Core Web Vitals ingest on %s', (kind) => {
  let server: TestServer
  let site: Site
  beforeEach(async () => {
    server = await testServer(kind)
    site = (await server.createSite()).site
  })
  afterEach(() => server.close())

  const enable = (vitalsSample = 10) =>
    server.adminJson<Site>(`/sites/${site.id}`, { method: 'PATCH', json: { vitalsSample } })
  const rows = () => server.rows<Row>('SELECT * FROM vitals ORDER BY ts')
  /** What the tracker sends when a page is left: the time spent, and the vitals. */
  const leave = (v: unknown, path = '/pricing', extra: Record<string, unknown> = {}) =>
    server.event({ w: site.id, t: 'ping', u: `https://example.com${path}`, d: 5000, v, ...extra })
  const visit = (path = '/pricing', extra: Record<string, unknown> = {}) =>
    server.event({ w: site.id, t: 'pageview', u: `https://example.com${path}`, ...extra })

  it('is off for a new site: reports are accepted and dropped', async () => {
    expect(site.vitalsSample).toBe(0)
    await visit()
    expect((await leave({ l: 2000, i: 100, c: 0.1 })).status).toBe(202)
    expect(await rows()).toEqual([])
  })

  it('stores one row per report with the page path and the three numbers, and still counts the time', async () => {
    await enable()
    await visit('/pricing')
    server.advance(5000)
    expect((await leave({ l: 2100.4, i: 119.6, c: 0.0504 }, '/pricing?utm_source=x#top')).status).toBe(202)
    expect(await rows()).toEqual([
      { site_id: site.id, ts: server.now, path: '/pricing', lcp: 2100, inp: 120, cls: 0.05 },
    ])
    const [session] = await server.rows<{ duration: number }>('SELECT duration FROM sessions')
    expect(session?.duration).toBe(5000)
  })

  it('keeps the metrics a browser could measure and stores the rest as null', async () => {
    await enable()
    await leave({ l: 1800 })
    await leave({ c: 0 }, '/blog')
    expect((await rows()).map((r) => [r.path, r.lcp, r.inp, r.cls])).toEqual([
      ['/pricing', 1800, null, null],
      ['/blog', null, null, 0],
    ])
  })

  it('refuses malformed values, and drops a report with nothing usable', async () => {
    await enable()
    const bad = [
      null,
      'x',
      [],
      {},
      { l: 'fast' },
      { l: -1 },
      { l: 60_001 },
      { i: Infinity },
      { i: null },
      { c: 11 },
      { c: -0.1 },
      { x: 1 },
    ]
    for (const v of bad) expect((await leave(v)).status, JSON.stringify(v)).toBe(202)
    expect(await rows()).toEqual([])
    // One good number next to bad ones: the good one is kept.
    await leave({ l: 'x', i: 80, c: 99 })
    expect(await rows()).toMatchObject([{ lcp: null, inp: 80, cls: null }])
  })

  it('stores no identifier in strict mode, or in any other: the table has no such column', async () => {
    await enable()
    await leave({ l: 1000, i: 50, c: 0.01 })
    const [row] = await rows()
    expect(Object.keys(row ?? {}).sort()).toEqual(['cls', 'inp', 'lcp', 'path', 'site_id', 'ts'])
    const persistent = await server.adminJson<Site>(`/sites/${site.id}`, {
      method: 'PATCH',
      json: { privacyMode: 'persistent' },
    })
    expect(persistent.privacyMode).toBe('persistent')
    const vid = 'v'.repeat(24)
    const sid = 's'.repeat(24)
    await leave({ l: 900 }, '/docs', { m: 'persistent', vid, sid })
    expect(JSON.stringify(await rows())).not.toContain(vid)
    expect(JSON.stringify(await rows())).not.toContain(sid)
  })

  it('ignores reports from filtered traffic like any other event', async () => {
    await enable()
    await server.adminJson(`/sites/${site.id}`, { method: 'PATCH', json: { paused: true } })
    expect((await leave({ l: 1000 })).status).toBe(202)
    expect(await rows()).toEqual([])
  })

  it('validates the setting', async () => {
    for (const vitalsSample of [-1, 101, 1.5, '10', null]) {
      const response = await server.admin(`/sites/${site.id}`, { method: 'PATCH', json: { vitalsSample } })
      expect(response.status, String(vitalsSample)).toBe(400)
    }
    expect((await enable(100)).vitalsSample).toBe(100)
    expect((await enable(0)).vitalsSample).toBe(0)
  })

  it('follows the retention setting', async () => {
    await enable()
    await server.adminJson(`/sites/${site.id}`, { method: 'PATCH', json: { retentionDays: 30 } })
    await leave({ l: 1000 }, '/old')
    server.advance(31 * DAY)
    // Retention runs on the next event, like it does for events and sessions.
    await leave({ l: 1000 }, '/new')
    expect((await rows()).map((r) => r.path)).toEqual(['/new'])
  })

  it('goes with the purge route and with the deletion of the site', async () => {
    await enable()
    await leave({ l: 1000 }, '/old')
    const before = new Date(server.now + DAY).toISOString()
    await server.adminJson(`/sites/${site.id}/data?before=${before}`, { method: 'DELETE' })
    expect(await rows()).toEqual([])

    await leave({ l: 1000 }, '/again')
    await server.adminJson(`/sites/${site.id}`, {
      method: 'DELETE',
      json: { confirm: 'example.com', password: PASSWORD },
    })
    expect(await rows()).toEqual([])
  })
})
