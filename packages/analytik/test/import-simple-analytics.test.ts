import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createContext } from '../src/server/context'
import { importVisits } from '../src/server/import/core'
import { createSite } from '../src/server/sites'
import { parseCsv } from '../src/shared/import/csv'
import { mapSimpleAnalytics } from '../src/shared/import/simple-analytics'
import { memoryStorage } from '../src/storage/memory'

const rows = parseCsv(readFileSync(join(import.meta.dirname, 'fixtures/import/simple-analytics.csv'), 'utf8'))

describe('simple analytics mapper', () => {
  it('rebuilds visits from a fingerprint, since its session_id is a page-load id', () => {
    const { visits } = mapSimpleAnalytics(rows)
    // Same person, 50 minutes of silence in between: two visits. A second person is a third.
    expect(visits.map((visit) => visit.events.map((event) => event.path))).toEqual([
      ['/', '/pricing', '/pricing'],
      ['/'],
      ['/blog'],
    ])
    const [first, later, second] = visits
    expect(first?.visitor).toBe(later?.visitor)
    expect(first?.visitor).not.toBe(second?.visitor)
    expect(first).toMatchObject({
      startedAt: Date.UTC(2026, 2, 10, 9),
      referrer: 'https://www.google.com/',
      country: 'SK',
      browser: 'Chrome',
      os: 'Mac OS',
      device: 'Desktop',
      // Time on page, summed.
      durationMs: 42_000,
    })
    expect(first?.events.map((event) => [event.type, event.name])).toEqual([
      ['pageview', null],
      ['pageview', null],
      ['goal', 'signup'],
    ])
    expect(second).toMatchObject({
      utmSource: 'newsletter',
      utmMedium: 'email',
      utmCampaign: 'march',
      device: 'Mobile',
      os: 'iOS',
      durationMs: null,
    })
  })

  it('splits exactly at 30 minutes of silence', () => {
    const base = { path: '/', datapoint: 'pageview', user_agent: 'x' }
    const at = (ms: number) => ({ ...base, added_iso: new Date(Date.UTC(2026, 2, 10) + ms).toISOString() })
    const minute = 60_000
    expect(mapSimpleAnalytics([at(0), at(30 * minute)]).visits).toHaveLength(1)
    expect(mapSimpleAnalytics([at(0), at(30 * minute + 1)]).visits).toHaveLength(2)
  })

  it('skips robots and bad rows with their row numbers', () => {
    const { skipped } = mapSimpleAnalytics(rows)
    expect(skipped).toEqual([
      { row: 6, reason: 'made by a robot' },
      { row: 7, reason: 'path is missing' },
      { row: 8, reason: 'added_iso is missing or not a date' },
    ])
  })

  it('imports the fixture and recognises it on a repeat and on an export cut at another point', async () => {
    const storage = memoryStorage()
    await storage.migrate()
    const ctx = createContext({ storage, now: () => Date.UTC(2026, 2, 16) })
    const { site } = await createSite(ctx, { domain: 'example.com' })
    const { visits } = mapSimpleAnalytics(rows)
    expect(await importVisits(ctx, site, 'simple-analytics', visits)).toMatchObject({ visits: 3, events: 5 })
    expect(await importVisits(ctx, site, 'simple-analytics', visits)).toMatchObject({ visits: 0, events: 0 })

    // The same data exported again from its second row: the first visit starts later, but no row is added twice.
    const later = mapSimpleAnalytics(rows.slice(1))
    expect(await importVisits(ctx, site, 'simple-analytics', later.visits)).toMatchObject({ visits: 0, events: 0 })
    const [{ n } = { n: 0 }] = await storage.query<{ n: number }>('SELECT COUNT(*) AS n FROM sessions')
    expect(n).toBe(3)
    await storage.close?.()
  })
})
