import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Site, VitalsResult } from '../src/shared/types'
import { rateVital } from '../src/shared/vitals'
import { VITALS_PAGE_LIMIT, VITALS_ROW_CAP } from '../src/server/stats/vitals'
import { storageKinds } from './helpers/databases'
import { type TestServer, testServer } from './helpers/server'

const MARCH = Date.UTC(2026, 2, 10)
const range = '?from=2026-03-01&to=2026-03-31&tz=UTC'

describe('rateVital', () => {
  it('uses the standard thresholds: good up to the first, poor above the second', () => {
    expect([2500, 2500.1, 4000, 4000.1].map((v) => rateVital('lcp', v))).toEqual([
      'good',
      'needs-work',
      'needs-work',
      'poor',
    ])
    expect([200, 201, 500, 501].map((v) => rateVital('inp', v))).toEqual(['good', 'needs-work', 'needs-work', 'poor'])
    expect([0.1, 0.11, 0.25, 0.26].map((v) => rateVital('cls', v))).toEqual([
      'good',
      'needs-work',
      'needs-work',
      'poor',
    ])
  })
})

describe.each(storageKinds())('the vitals view on %s', (kind) => {
  let server: TestServer
  let site: Site
  beforeEach(async () => {
    server = await testServer(kind)
    site = (await server.createSite()).site
  })
  afterEach(() => server.close())

  const seed = async (
    rows: [path: string, lcp: number | null, inp: number | null, cls: number | null, ts?: number][],
  ) => {
    for (const [path, lcp, inp, cls, ts] of rows) {
      await server.storage.run('INSERT INTO vitals (site_id, ts, path, lcp, inp, cls) VALUES (?, ?, ?, ?, ?, ?)', [
        site.id,
        ts ?? MARCH,
        path,
        lcp,
        inp,
        cls,
      ])
    }
  }
  const read = (suffix = range, id = site.id) => server.adminJson<VitalsResult>(`/sites/${id}/vitals${suffix}`)

  it('is empty and says so for a site that does not measure them', async () => {
    expect(await read()).toEqual({
      enabled: false,
      total: { samples: 0, lcp: null, inp: null, cls: null },
      pages: [],
    })
  })

  it('takes the 75th percentile (nearest rank) of each metric, per page and overall', async () => {
    await server.adminJson(`/sites/${site.id}`, { method: 'PATCH', json: { vitalsSample: 10 } })
    await seed([
      ['/a', 4000, 200, 0.3],
      ['/a', 1000, 50, 0.01],
      ['/a', 3000, null, 0.05],
      ['/a', 2000, 100, 0.2],
      ['/b', 100, null, null],
      ['/b', null, 40, null],
    ])
    const result = await read()
    expect(result.enabled).toBe(true)
    // /a LCP: 1000 2000 3000 4000, rank ceil(0.75 * 4) = 3. /a INP: 50 100 200, rank ceil(2.25) = 3.
    expect(result.pages).toEqual([
      { path: '/a', samples: 4, lcp: 3000, inp: 200, cls: 0.2 },
      { path: '/b', samples: 2, lcp: 100, inp: 40, cls: null },
    ])
    // Overall LCP: 100 1000 2000 3000 4000, rank ceil(3.75) = 4. INP: 40 50 100 200, rank 3.
    expect(result.total).toEqual({ samples: 6, lcp: 3000, inp: 100, cls: 0.2 })
  })

  it('rounds the answers and uses only the range', async () => {
    await seed([
      ['/a', 1000.4, null, 0.0504],
      ['/a', 9999, null, 9, Date.UTC(2026, 3, 2)],
      ['/a', 9999, null, 9, Date.UTC(2026, 1, 28)],
    ])
    const result = await read()
    expect(result.total).toEqual({ samples: 1, lcp: 1000, inp: null, cls: 0.05 })
    const april = await read('?from=2026-04-01&to=2026-04-30&tz=UTC')
    expect(april.total).toMatchObject({ samples: 1, lcp: 9999 })
  })

  it('lists the busiest pages first, at most fifty, and counts the rest in the total', async () => {
    const rows: Parameters<typeof seed>[0] = Array.from({ length: VITALS_PAGE_LIMIT + 5 }, (_, i) => [
      `/p${String(i).padStart(2, '0')}`,
      1000,
      null,
      null,
    ])
    rows.push(['/busy', 2000, null, null], ['/busy', 2000, null, null])
    await seed(rows)
    const result = await read()
    expect(result.pages).toHaveLength(VITALS_PAGE_LIMIT)
    expect(result.pages[0]).toMatchObject({ path: '/busy', samples: 2 })
    expect(result.total.samples).toBe(VITALS_PAGE_LIMIT + 5 + 2)
  })

  it('reads a bounded number of the newest reports with a few queries, whatever the size of the table', async () => {
    await seed([['/a', 1000, null, null]])
    const spy = vi.spyOn(server.storage, 'query')
    await read()
    const reads = spy.mock.calls.map(([sql]) => sql).filter((sql) => sql.includes('FROM vitals'))
    // Three metrics, per page and overall, plus the page counts and the total.
    expect(reads).toHaveLength(8)
    for (const sql of reads) expect(sql).toContain(`ORDER BY ts DESC LIMIT ${VITALS_ROW_CAP}`)
  })

  it('answers with a private one minute cache, to admins only', async () => {
    const response = await server.admin(`/sites/${site.id}/vitals${range}`)
    expect(response.headers.get('cache-control')).toBe('private, max-age=60')
    const { token } = await server.adminJson<{ token: string }>(`/sites/${site.id}/share-links`, {
      method: 'POST',
      json: {},
    })
    expect((await server.request(`/sites/${site.id}/vitals${range}&share=${token}`)).status).toBe(401)
    expect((await server.request(`/sites/${site.id}/vitals${range}`)).status).toBe(401)
  })

  it('is part of the programmatic stats API', async () => {
    await seed([['/a', 1000, null, null]])
    const result = await server.analytik.stats.vitals(site.id, {
      from: Date.UTC(2026, 2, 1),
      to: Date.UTC(2026, 3, 1),
    })
    expect(result.total.samples).toBe(1)
    await expect(server.analytik.stats.vitals('missing', { from: 0, to: 1 })).rejects.toThrow('site not found')
  })
})
