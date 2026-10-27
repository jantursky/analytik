import { afterEach, describe, expect, it } from 'vitest'

import { seedDemo } from '../src/migrate'
import { createAnalytik } from '../src/server'
import { DAY } from '../src/shared/time'
import type { Storage } from '../src/storage/types'
import { createStorage, storageKinds } from './helpers/databases'

const NOW = Date.UTC(2026, 9, 27, 15, 30)

let storages: Storage[] = []

afterEach(async () => {
  for (const storage of storages) await storage.close?.()
  storages = []
})

async function open(kind: Parameters<typeof createStorage>[0]): Promise<Storage> {
  const storage = await createStorage(kind)
  storages.push(storage)
  return storage
}

const dumpAll = (storage: Storage) =>
  Promise.all(
    ['sites', 'visitors', 'sessions', 'events', 'payments', 'funnels'].map((table) =>
      storage.query(`SELECT * FROM ${table} ORDER BY id`),
    ),
  )

describe.each(storageKinds())('seedDemo on %s', (kind) => {
  it('fills a demo site that the stats can read', async () => {
    const storage = await open(kind)
    const result = await seedDemo(storage, { now: NOW, days: 7, visitorsPerDay: 40, seed: 3 })
    expect(result.siteId).toBe('demo')
    expect(result.apiKey).toMatch(/^ak_demo0003[0-9a-f]{24}$/)
    expect(result.counts.sessions).toBeGreaterThan(150)
    expect(result.counts.funnels).toBe(2)

    const analytik = createAnalytik({ storage, now: () => NOW })
    const query = { from: NOW - 7 * DAY, to: NOW }
    const overview = await analytik.stats.overview('demo', query)
    expect(overview.visitors.value).toBeGreaterThan(100)
    expect(overview.pageviews.value).toBeGreaterThan(overview.sessions.value)
    expect(overview.online).toBeGreaterThan(0)
    const channels = await analytik.stats.breakdown('demo', 'channel', query)
    expect(channels.map((row) => row.key)).toEqual(
      expect.arrayContaining(['Direct', 'Organic Search', 'Paid', 'Email']),
    )
    const funnel = await analytik.stats.funnel('demo', 'demo-signup-demo', query)
    expect(funnel?.steps[0]?.visitors).toBeGreaterThan(0)
    const [{ n } = { n: 0 }] = await storage.query<{ n: number }>(
      'SELECT COUNT(*) AS n FROM sites WHERE api_key_hash <> ?',
      [''],
    )
    expect(n).toBe(1)
  })
})

describe('seedDemo', () => {
  it('is deterministic and adds nothing when run again', async () => {
    const options = {
      now: NOW,
      days: 10,
      visitorsPerDay: 30,
      seed: 7,
      siteId: 'shop',
      domain: 'shop.dev',
      name: 'Shop',
      currency: 'EUR',
    }
    const first = await open('memory')
    const second = await open('memory')
    const a = await seedDemo(first, options)
    const b = await seedDemo(second, options)
    expect(a).toEqual(b)
    expect(await dumpAll(first)).toEqual(await dumpAll(second))
    await seedDemo(first, options)
    expect(await dumpAll(first)).toEqual(await dumpAll(second))
    const payments = await first.query<{ kind: string; amount: number }>('SELECT kind, amount FROM payments')
    expect(payments.length).toBe(a.counts.payments)
    expect(payments.some((payment) => payment.kind === 'payment' && payment.amount > 0)).toBe(true)
    expect(await first.query('SELECT name, currency FROM sites')).toEqual([{ name: 'Shop', currency: 'EUR' }])
  })

  it('gives different data for another seed and keeps everything in the past', async () => {
    const one = await open('memory')
    const two = await open('memory')
    await seedDemo(one, { now: NOW, days: 3, visitorsPerDay: 20, seed: 1 })
    await seedDemo(two, { now: NOW, days: 3, visitorsPerDay: 20, seed: 2 })
    expect(await dumpAll(one)).not.toEqual(await dumpAll(two))
    const [latest] = await one.query<{ ts: number }>('SELECT MAX(ts) AS ts FROM events')
    expect(latest?.ts).toBeLessThanOrEqual(NOW)
  })

  it('defaults to a month ending now', async () => {
    const storage = await open('memory')
    const result = await seedDemo(storage, { visitorsPerDay: 2 })
    expect(result.counts.sessions).toBeGreaterThan(20)
  })
})
