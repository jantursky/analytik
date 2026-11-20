import { afterEach, describe, expect, it, vi } from 'vitest'

import { purgeBefore, purgeChunked } from '../src/server/stats/purge'
import { DAY, HOUR } from '../src/shared/time'
import type { Site } from '../src/shared/types'
import { storageKinds } from './helpers/databases'
import { START, type TestServer, testServer } from './helpers/server'

const count = async (server: TestServer, table: string) =>
  Number((await server.rows<{ n: number | string }>(`SELECT COUNT(*) AS n FROM ${table}`))[0]?.n)

describe.each(storageKinds())('scheduled retention on %s', (kind) => {
  let server: TestServer
  let site: Site
  afterEach(() => server.close())

  const open = async (options: Parameters<typeof testServer>[1] = {}, site2: Record<string, unknown> = {}) => {
    server = await testServer(kind, options)
    site = (await server.createSite(site2)).site
  }

  /** One visitor and session per day, each with one pageview, the first `days` days before START. */
  const seed = async (days: number, siteId = site.id, domain = 'example.com') => {
    for (let day = days; day >= 1; day--) {
      server.now = START - day * DAY
      await server.event(
        { w: siteId, t: 'pageview', u: `https://${domain}/`, m: 'persistent', vid: `v-${day}`, sid: `s-${day}` },
        { origin: `https://${domain}` },
      )
    }
    server.now = START
  }

  describe('purgeChunked', () => {
    const cut = () => START - 6.5 * DAY

    it('removes what purgeBefore removes, in chunks of a few rows', async () => {
      await open()
      await seed(12)
      await server.storage.run(
        `INSERT INTO payments (id, site_id, provider, ts, amount, currency, email, visitor_id) VALUES ('p1', ?, 'x', ?, 500, 'USD', 'a@b.c', 'v-9')`,
        [site.id, START - 9 * DAY],
      )
      // Visitor rows exist for identified people; three old ones without a session go, a recent one stays.
      for (const [id, age] of [
        ['o1', 10],
        ['o2', 11],
        ['o3', 12],
        ['recent', 1],
      ] as const) {
        await server.storage.run('INSERT INTO visitors (site_id, id, first_seen) VALUES (?, ?, ?)', [
          site.id,
          id,
          START - age * DAY,
        ])
      }
      const result = await purgeChunked(server.context, site.id, cut(), Number.POSITIVE_INFINITY, 2)
      expect(result).toEqual({ events: 6, sessions: 6, visitors: 3, done: true })
      expect(await count(server, 'events')).toBe(6)
      // The seeded visits share one visitor, who still has recent sessions, so that visitor stays too.
      expect(await count(server, 'visitors')).toBe(2)
      const [payment] = await server.rows<{ amount: number | string; email: string | null; visitor_id: string | null }>(
        'SELECT amount, email, visitor_id FROM payments',
      )
      expect([Number(payment?.amount), payment?.email, payment?.visitor_id]).toEqual([500, null, null])
      // Nothing is left to do, and the whole purge in one go agrees.
      expect(await purgeBefore(server.context, site.id, cut())).toEqual({ events: 0, sessions: 0, visitors: 0 })
    })

    it('stops after the time budget and continues on the next run', async () => {
      await open()
      await seed(12)
      const first = await purgeChunked(server.context, site.id, cut(), 0, 2)
      expect(first.done).toBe(false)
      expect(first.events).toBeGreaterThan(0)
      expect(first.events).toBeLessThan(6)
      let total = first.events
      for (let run = 0; run < 20; run++) {
        const next = await purgeChunked(server.context, site.id, cut(), 0, 2)
        total += next.events
        if (next.done) break
      }
      expect(total).toBe(6)
      expect(await count(server, 'events')).toBe(6)
    })

    it('removes rows that share one time, even when they outnumber a chunk', async () => {
      await open()
      await seed(8)
      await server.storage.run('UPDATE events SET ts = ?', [START - 20 * DAY])
      const result = await purgeChunked(server.context, site.id, cut(), Number.POSITIVE_INFINITY, 3)
      expect(result.events).toBe(8)
      expect(await count(server, 'events')).toBe(0)
    })

    it('leaves another site alone', async () => {
      await open()
      const other = (await server.createSite({ name: 'Other', domain: 'other.com' })).site
      await seed(4)
      await seed(4, other.id, 'other.com')
      await purgeChunked(server.context, site.id, START, Number.POSITIVE_INFINITY, 2)
      expect(await server.rows('SELECT 1 FROM events WHERE site_id = ?', [site.id])).toHaveLength(0)
      expect(await server.rows('SELECT 1 FROM events WHERE site_id = ?', [other.id])).toHaveLength(4)
    })
  })

  describe('POST /v1/cron', () => {
    const cron = (secret?: string, method = 'POST') =>
      server.request('/v1/cron', { method, headers: secret ? { authorization: `Bearer ${secret}` } : {} })
    const patch = (retentionDays: number | null, id = site.id) =>
      server.admin(`/sites/${id}`, { method: 'PATCH', json: { retentionDays } })

    it('answers 401 without the secret, also when only retention needs it', async () => {
      await open({ cronSecret: 'cron-secret-123' })
      expect((await cron()).status).toBe(401)
      expect((await cron('wrong')).status).toBe(401)
    })

    it('purges a quiet site with a retention period and leaves one without alone', async () => {
      await open({ cronSecret: 'cron-secret-123' }, { name: 'Quiet', domain: 'example.com' })
      const keep = (await server.createSite({ name: 'Keep', domain: 'keep.com' })).site
      await patch(30)
      await seed(40)
      await seed(40, keep.id, 'keep.com')
      server.now = START + 7 * DAY
      const response = await cron('cron-secret-123')
      const body = (await response.json()) as {
        ok: boolean
        retention: { done: boolean; sites: Record<string, { events: number }> }
      }
      expect(response.status).toBe(200)
      expect(body.retention.done).toBe(true)
      expect(Object.keys(body.retention.sites)).toEqual([site.id])
      // Events dated from 40 to 1 days before START; 37 days of them are older than 30 days at START + 7 days.
      expect(body.retention.sites[site.id]?.events).toBe(17)
      expect(await server.rows('SELECT 1 FROM events WHERE site_id = ?', [keep.id])).toHaveLength(40)
    })

    it('takes the secret from email.cronSecret too', async () => {
      await open({ email: { send: vi.fn(() => Promise.resolve()), from: 'a@b.c', cronSecret: 'mail-secret' } })
      expect((await cron('mail-secret', 'GET')).status).toBe(200)
    })

    it('reports done: false when the budget is spent and finishes on the next call', async () => {
      await open({ cronSecret: 'cron-secret-123', retentionBudgetMs: 0 })
      await patch(30)
      await seed(40)
      server.now = START + 7 * DAY
      const first = (await (await cron('cron-secret-123')).json()) as { retention: { done: boolean } }
      expect(first.retention.done).toBe(false)
      expect(await count(server, 'events')).toBe(40)
    })

    it('finishes a large backlog over several calls', async () => {
      await open({ cronSecret: 'cron-secret-123' })
      await patch(30)
      await seed(40)
      server.now = START + 7 * DAY
      const body = (await (await cron('cron-secret-123')).json()) as { retention: { done: boolean } }
      expect(body.retention.done).toBe(true)
      expect(await count(server, 'events')).toBe(23)
    })
  })

  describe('the ingest path', () => {
    const deletes = (server: TestServer) => {
      const run = server.storage.run.bind(server.storage)
      const seen: string[] = []
      server.storage.run = (sql, params) => {
        if (/^\s*(DELETE FROM (events|sessions|visitors|vitals|bot_requests|payment_claims)|UPDATE payments)/.test(sql))
          seen.push(sql)
        return run(sql, params)
      }
      return seen
    }

    it('runs no purge statement when a cron secret is set', async () => {
      await open({ cronSecret: 'cron-secret-123' })
      await server.admin(`/sites/${site.id}`, { method: 'PATCH', json: { retentionDays: 30 } })
      await seed(3)
      const seen = deletes(server)
      server.now = START + 40 * DAY
      await server.event({
        w: site.id,
        t: 'pageview',
        u: 'https://example.com/',
        m: 'persistent',
        vid: 'late',
        sid: 'late-s',
      })
      server.now += HOUR
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(seen).toEqual([])
      expect(await count(server, 'events')).toBe(4)
    })

    it('still purges after the response without a cron secret', async () => {
      await open()
      await server.admin(`/sites/${site.id}`, { method: 'PATCH', json: { retentionDays: 30 } })
      await seed(3)
      server.now = START + 40 * DAY
      await server.event({
        w: site.id,
        t: 'pageview',
        u: 'https://example.com/',
        m: 'persistent',
        vid: 'late',
        sid: 'late-s',
      })
      await vi.waitFor(async () => expect(await count(server, 'events')).toBe(1))
    })
  })
})
