import { afterEach, describe, expect, it } from 'vitest'

import { createContext, type Context } from '../src/server/context'
import { importVisits } from '../src/server/import/core'
import { listImports, removeImport } from '../src/server/import/manage'
import { createSite, type SiteRecord } from '../src/server/sites'
import type { ImportVisit } from '../src/shared/import/types'
import { DAY } from '../src/shared/time'
import type { Storage } from '../src/storage/types'
import { createStorage, storageKinds } from './helpers/databases'

const NOW = Date.UTC(2026, 2, 16, 12)

function visit(id: string, overrides: Partial<ImportVisit> = {}): ImportVisit {
  return {
    id,
    visitor: `person-${id}`,
    hostname: 'www.example.com',
    referrer: 'https://news.ycombinator.com/item?id=1',
    country: 'SK',
    browser: 'Chrome',
    os: 'macOS',
    device: 'Desktop',
    events: [
      { ts: NOW - 2 * DAY, type: 'pageview', name: null, path: '/' },
      { ts: NOW - 2 * DAY + 5_000, type: 'pageview', name: null, path: '/pricing' },
      { ts: NOW - 2 * DAY + 6_000, type: 'goal', name: 'signup', path: '/pricing', props: { plan: 'pro' } },
    ],
    ...overrides,
  }
}

describe.each(storageKinds())('import core on %s', (kind) => {
  let storage: Storage
  let ctx: Context
  let site: SiteRecord

  const setup = async (input: Record<string, unknown> = {}) => {
    storage = await createStorage(kind)
    await storage.migrate()
    ctx = createContext({ storage, now: () => NOW })
    site = (await createSite(ctx, { domain: 'example.com', ...input })).site
  }

  afterEach(async () => {
    await storage.close?.()
  })

  const count = async (table: string) =>
    Number(
      (await storage.query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE site_id = ?`, [site.id]))[0]?.n,
    )

  it('stores visits, events and visitors marked with their source', async () => {
    await setup()
    const result = await importVisits(ctx, site, 'umami', [visit('a'), visit('b')])
    expect(result).toEqual({
      visits: 2,
      events: 6,
      existing: { visits: 0, events: 0 },
      tooOld: { visits: 0, events: 0 },
    })
    const [session] = await storage.query(`SELECT * FROM sessions WHERE site_id = ? ORDER BY id LIMIT 1`, [site.id])
    expect(session).toMatchObject({
      imported: 'umami',
      pageviews: 2,
      goals: 1,
      entry_page: '/',
      exit_page: '/pricing',
      hostname: 'example.com',
      referrer_domain: 'news.ycombinator.com',
      country: 'SK',
      browser: 'Chrome',
      lat: null,
      lon: null,
    })
    expect(String(session?.id)).toMatch(/^imp:umami:s/)
    expect(String(session?.visitor_id)).toMatch(/^imp:umami:v/)
    expect(await count('visitors')).toBe(2)
    const goal = await storage.query<{ name: string; props: string; imported: string }>(
      `SELECT name, props, imported FROM events WHERE site_id = ? AND type = 'goal' LIMIT 1`,
      [site.id],
    )
    expect(goal[0]).toMatchObject({ name: 'signup', imported: 'umami' })
    expect(JSON.parse(goal[0]!.props)).toEqual({ plan: 'pro' })
  })

  it('adds nothing when the same visits are imported again', async () => {
    await setup()
    await importVisits(ctx, site, 'umami', [visit('a')])
    const again = await importVisits(ctx, site, 'umami', [visit('a')])
    expect(again).toEqual({
      visits: 0,
      events: 0,
      existing: { visits: 1, events: 3 },
      tooOld: { visits: 0, events: 0 },
    })
    expect(await count('sessions')).toBe(1)
    expect(await count('events')).toBe(3)
  })

  it('keeps identical events of one visit and still finds them on a repeat', async () => {
    await setup()
    const doubled = visit('a', {
      events: [0, 0].map(() => ({ ts: NOW - DAY, type: 'pageview', name: null, path: '/' })),
    })
    await importVisits(ctx, site, 'umami', [doubled])
    expect(await count('events')).toBe(2)
    await importVisits(ctx, site, 'umami', [doubled])
    expect(await count('events')).toBe(2)
  })

  it('resumes after a partial run and tops up a visit split across chunks', async () => {
    await setup()
    const full = visit('a')
    const [first, second, third] = full.events
    await importVisits(ctx, site, 'umami', [{ ...full, events: [first!] }])
    const resumed = await importVisits(ctx, site, 'umami', [full])
    expect(resumed).toMatchObject({ visits: 0, events: 2, existing: { visits: 1, events: 1 } })
    expect(await count('sessions')).toBe(1)
    expect(await count('events')).toBe(3)
    const [session] = await storage.query(`SELECT * FROM sessions WHERE site_id = ?`, [site.id])
    expect(session).toMatchObject({ pageviews: 2, goals: 1, exit_page: '/pricing', last_seen_at: third!.ts })
    expect(second).toBeDefined()
  })

  it('skips visits and events older than the retention limit', async () => {
    await setup({ retentionDays: 30 })
    const old = visit('old', { events: [{ ts: NOW - 90 * DAY, type: 'pageview', name: null, path: '/' }] })
    const straddling = visit('mixed', {
      startedAt: NOW - 29 * DAY,
      events: [
        { ts: NOW - 40 * DAY, type: 'pageview', name: null, path: '/gone' },
        { ts: NOW - 29 * DAY, type: 'pageview', name: null, path: '/kept' },
      ],
    })
    const result = await importVisits(ctx, site, 'umami', [old, straddling, visit('recent')])
    expect(result).toMatchObject({ visits: 2, events: 4, tooOld: { visits: 1, events: 2 } })
    expect(await count('sessions')).toBe(2)
  })

  it('leaves tracked data alone and never merges visitors', async () => {
    await setup()
    await storage.run(
      `INSERT INTO sessions (site_id, id, visitor_id, started_at, last_seen_at, source, channel)
       VALUES (?, 'tracked', 'person-a', ?, ?, 'Direct/None', 'Direct')`,
      [site.id, NOW - DAY, NOW - DAY],
    )
    await importVisits(ctx, site, 'umami', [visit('a')])
    expect(await count('sessions')).toBe(2)
    const rows = await storage.query<{ id: string; imported: string | null }>(
      `SELECT id, imported FROM sessions WHERE site_id = ? ORDER BY id`,
      [site.id],
    )
    expect(rows.find((row) => row.id === 'tracked')?.imported).toBeNull()
  })

  it('imports more visits than fit in one batch', async () => {
    await setup()
    const visits = Array.from({ length: 120 }, (_, index) => visit(`v${index}`))
    const result = await importVisits(ctx, site, 'umami', visits)
    expect(result.visits).toBe(120)
    expect(await count('events')).toBe(360)
  })
})

describe.each(storageKinds())('imports list and removal on %s', (kind) => {
  it('lists each source and removes one without touching tracked or other imported data', async () => {
    const storage = await createStorage(kind)
    await storage.migrate()
    const ctx = createContext({ storage, now: () => NOW })
    const { site } = await createSite(ctx, { domain: 'example.com' })
    await storage.run(
      `INSERT INTO sessions (site_id, id, visitor_id, started_at, last_seen_at, source, channel)
       VALUES (?, 'tracked', 'tracked-visitor', ?, ?, 'Direct/None', 'Direct')`,
      [site.id, NOW - DAY, NOW - DAY],
    )
    await storage.run(`INSERT INTO visitors (site_id, id, first_seen) VALUES (?, 'tracked-visitor', ?)`, [
      site.id,
      NOW - DAY,
    ])
    await storage.run(
      `INSERT INTO events (id, site_id, session_id, visitor_id, ts, type, path) VALUES ('t1', ?, 'tracked', 'tracked-visitor', ?, 'pageview', '/')`,
      [site.id, NOW - DAY],
    )
    await importVisits(ctx, site, 'umami', [visit('a'), visit('b')])
    await importVisits(ctx, site, 'simple-analytics', [visit('a')])

    expect(await listImports(ctx, site.id)).toEqual([
      { source: 'simple-analytics', visits: 1, events: 3, from: NOW - 2 * DAY, to: NOW - 2 * DAY },
      { source: 'umami', visits: 2, events: 6, from: NOW - 2 * DAY, to: NOW - 2 * DAY },
    ])

    expect(await removeImport(ctx, site.id, 'umami')).toEqual({ visits: 2, events: 6, visitors: 2 })
    expect((await listImports(ctx, site.id)).map((item) => item.source)).toEqual(['simple-analytics'])
    const left = async (table: string) =>
      Number((await storage.query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))[0]?.n)
    expect(await left('sessions')).toBe(2)
    expect(await left('events')).toBe(4)
    expect(await left('visitors')).toBe(2)
    await storage.close?.()
  })
})
