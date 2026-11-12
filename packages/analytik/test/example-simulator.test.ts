import { describe, expect, it } from 'vitest'

import { createSimulator } from '../../../apps/example/server/simulator'
import { seedDemo } from '../src/migrate'
import { createAnalytik } from '../src/server'
import { memoryStorage } from '../src/storage/memory'

describe('the demo simulator', () => {
  it('reports Core Web Vitals with page leaves, on top of the seeded ones', async () => {
    const storage = memoryStorage()
    await storage.migrate()
    const now = Date.UTC(2026, 9, 27, 15, 30)
    await seedDemo(storage, { now, days: 3, visitorsPerDay: 10, domain: 'demo.analytik.dev' })
    const analytik = createAnalytik({ storage, now: () => now })
    const count = async (): Promise<number> =>
      (await storage.query<{ n: number }>("SELECT COUNT(*) AS n FROM vitals WHERE site_id = 'demo'"))[0]?.n ?? 0
    const seeded = await count()
    expect(seeded).toBeGreaterThan(0)

    let state = 1
    const random = (): number => {
      state = (state * 48271) % 2147483647
      return state / 2147483647
    }
    const simulator = createSimulator({
      analytik,
      siteId: 'demo',
      origin: 'https://demo.analytik.dev',
      random,
      now: () => now,
    })
    for (let round = 0; round < 40; round++) await simulator.tick()
    expect(await count()).toBeGreaterThan(seeded)
    const [row] = await storage.query<{ lcp: number; cls: number }>(
      "SELECT lcp, cls FROM vitals WHERE site_id = 'demo' ORDER BY ts DESC LIMIT 1",
    )
    expect(row?.lcp).toBeGreaterThanOrEqual(1100)
    expect(row?.cls).toBeLessThanOrEqual(0.25)
  })
})
