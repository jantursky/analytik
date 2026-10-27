import { afterEach, describe, expect, it } from 'vitest'

import type { Site, TestDataResult } from '../src/shared/types'
import { storageKinds } from './helpers/databases'
import { type TestServer, testServer } from './helpers/server'

let server: TestServer | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
})

describe('debug test data', () => {
  it('is off unless the server opts in', async () => {
    server = await testServer()
    expect((await server.request('/debug')).status).toBe(401)
    expect(await server.adminJson('/debug')).toEqual({ enabled: false })
    const refused = await server.admin('/debug/generate', { method: 'POST', json: {} })
    expect(refused.status).toBe(404)
    expect(await refused.json()).toEqual({ error: 'debug tools are off; pass debug: true to createAnalytik()' })
    expect((await server.admin('/debug/sites', { method: 'DELETE' })).status).toBe(404)
    expect((await server.request('/debug/generate', { method: 'POST', body: '{}' })).status).toBe(401)
  })

  it.each(storageKinds())('makes test sites with traffic and payments on %s', { timeout: 30_000 }, async (kind) => {
    server = await testServer(kind, { debug: true })
    expect(await server.adminJson('/debug')).toEqual({ enabled: true })
    const result = await server.adminJson<TestDataResult>('/debug/generate', {
      method: 'POST',
      json: { sites: 2, days: 20, visitorsPerDay: 60, priceScale: 1000, currency: 'EUR' },
    })
    expect(result.sites).toHaveLength(2)
    expect(result.sites.every((site) => site.id.startsWith('debug-') && site.name.startsWith('Test site'))).toBe(true)
    expect(result.counts.sessions).toBeGreaterThan(500)
    expect(result.counts.events).toBeGreaterThan(result.counts.sessions)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)

    const sites = await server.adminJson<Site[]>('/sites')
    expect(sites.map((site) => site.currency)).toEqual(['EUR', 'EUR'])
    const [sessions] = await server.rows<{ count: number }>('SELECT COUNT(*) AS count FROM sessions')
    expect(Number(sessions?.count)).toBe(result.counts.sessions)
    // Prices are 900, 2,900 and 9,900 minor units, times 1000.
    const amounts = await server.rows<{ amount: number | string }>("SELECT amount FROM payments WHERE kind = 'payment'")
    expect(amounts.length).toBeGreaterThan(0)
    expect(amounts.every(({ amount }) => [900_000, 2_900_000, 9_900_000].includes(Number(amount)))).toBe(true)
  })

  it('adds to an existing site with fresh ids each run, and removes only test sites', async () => {
    server = await testServer('memory', { debug: true })
    const { site } = await server.createSite()
    const generate = () =>
      server?.adminJson<TestDataResult>('/debug/generate', {
        method: 'POST',
        json: { siteId: site.id, days: 5, visitorsPerDay: 40 },
      })
    const first = await generate()
    const second = await generate()
    expect(first?.sites).toEqual([{ id: site.id, name: 'Example' }])
    const [row] = await server.rows<{ count: number }>('SELECT COUNT(*) AS count FROM sessions WHERE site_id = ?', [
      site.id,
    ])
    expect(Number(row?.count)).toBe((first?.counts.sessions ?? 0) + (second?.counts.sessions ?? 0))

    await server.adminJson('/debug/generate', { method: 'POST', json: { sites: 3, days: 2, visitorsPerDay: 5 } })
    expect(await server.adminJson<Site[]>('/sites')).toHaveLength(4)
    expect(await server.adminJson('/debug/sites', { method: 'DELETE' })).toEqual({ deleted: 3 })
    expect((await server.adminJson<Site[]>('/sites')).map((s) => s.id)).toEqual([site.id])
    const leftover = await server.rows<{ count: number }>(
      "SELECT COUNT(*) AS count FROM sessions WHERE site_id LIKE 'debug-%'",
    )
    expect(Number(leftover[0]?.count)).toBe(0)
  })

  it('makes a realistic mix of different sites', async () => {
    server = await testServer('memory', { debug: true })
    const result = await server.adminJson<TestDataResult>('/debug/generate', {
      method: 'POST',
      // The mix ignores visitorsPerDay and priceScale.
      json: { sites: 12, days: 4, mix: true, visitorsPerDay: 100_000 },
    })
    expect(result.sites.map((site) => site.name.replace(/ \w+$/, ''))).toEqual([
      'Busy shop',
      'Empty site',
      'Company blog',
      'Side project',
      'Just launched',
      'Docs portal',
      'Premium SaaS',
      'Paused campaign',
      'News magazine',
      'Personal site',
      'Busy shop',
      'Empty site',
    ])
    const sessions = await server.rows<{ site_id: string; count: number | string }>(
      'SELECT site_id, COUNT(*) AS count FROM sessions GROUP BY site_id',
    )
    const count = (index: number): number =>
      Number(sessions.find((row) => row.site_id === result.sites[index]?.id)?.count ?? 0)
    expect(count(1)).toBe(0)
    expect(count(0)).toBeGreaterThan(count(2))
    expect(count(2)).toBeGreaterThan(count(3))
    expect(count(8)).toBeGreaterThan(count(0))
    const sites = await server.adminJson<Site[]>('/sites')
    expect(sites.filter((site) => site.paused).map((site) => site.name)).toEqual([result.sites[7]?.name])
    // Too much for one call even with the mix's own amounts.
    const refused = await server.admin('/debug/generate', { method: 'POST', json: { sites: 20, days: 730, mix: true } })
    expect(refused.status).toBe(400)
  })

  it('makes empty test sites with zero days or visits', async () => {
    server = await testServer('memory', { debug: true })
    const result = await server.adminJson<TestDataResult>('/debug/generate', {
      method: 'POST',
      json: { sites: 2, days: 0, visitorsPerDay: 0 },
    })
    expect(result.sites).toHaveLength(2)
    expect(result.counts).toEqual({ visitors: 0, sessions: 0, events: 0, payments: 0 })
    const sites = await server.adminJson<Site[]>('/sites')
    expect(sites).toHaveLength(2)
    expect(sites.every((site) => site.createdAt <= Date.UTC(2026, 2, 16, 12))).toBe(true)
    await server.adminJson('/debug/generate', { method: 'POST', json: { days: 10, visitorsPerDay: 0 } })
    expect(await server.rows('SELECT id FROM sessions')).toEqual([])
  })

  it('checks the amounts before writing anything', async () => {
    server = await testServer('memory', { debug: true })
    const refuse = async (json: unknown, error: string) => {
      const response = await server?.admin('/debug/generate', { method: 'POST', json })
      expect(response?.status).toBe(400)
      expect(await response?.json()).toEqual({ error })
    }
    await refuse({ sites: 0 }, 'sites must be a whole number from 1 to 20')
    await refuse({ days: 1.5 }, 'days must be a whole number from 0 to 730')
    await refuse({ visitorsPerDay: '10' }, 'visitorsPerDay must be a whole number from 0 to 100000')
    await refuse({ priceScale: 0 }, 'priceScale must be a number above 0 and up to 100000')
    await refuse({ currency: 'euro' }, 'currency must be a three-letter code such as USD')
    await refuse({ sites: 20, days: 730, visitorsPerDay: 100 }, 'at most 1,000,000 visits per call; ask for fewer')
    expect((await server.admin('/debug/generate', { method: 'POST', json: { siteId: 'nope' } })).status).toBe(404)
    expect(await server.adminJson('/sites')).toEqual([])
  })
})
