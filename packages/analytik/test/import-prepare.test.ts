import { describe, expect, it } from 'vitest'

import { createContext } from '../src/server/context'
import { importVisits } from '../src/server/import/core'
import { createSite } from '../src/server/sites'
import { CHUNK_EVENTS, CHUNK_VISITS, ImportFileError, chunkVisits, prepareImport } from '../src/shared/import/prepare'
import type { ImportVisit } from '../src/shared/import/types'
import { memoryStorage } from '../src/storage/memory'

const T0 = Date.UTC(2026, 2, 10)

const visit = (id: string, events: number): ImportVisit => ({
  id,
  visitor: id,
  startedAt: T0,
  events: Array.from({ length: events }, (_, index) => ({
    ts: T0 + index,
    type: 'pageview' as const,
    name: null,
    path: `/p${index}`,
  })),
})

describe('chunkVisits', () => {
  it('keeps every chunk within the visit and event limits and loses nothing', () => {
    const visits = [...Array.from({ length: 450 }, (_, i) => visit(`a${i}`, 1)), visit('b', 900), visit('c', 900)]
    const chunks = chunkVisits(visits)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(CHUNK_VISITS)
      expect(chunk.reduce((sum, v) => sum + v.events.length, 0)).toBeLessThanOrEqual(CHUNK_EVENTS)
    }
    expect(chunks.flat().reduce((sum, v) => sum + v.events.length, 0)).toBe(450 + 1800)
    expect(chunkVisits([])).toEqual([])
  })

  it('cuts a visit with more events than a request holds into pieces that join again on the server', async () => {
    const big = visit('giant', CHUNK_EVENTS * 2 + 5)
    const chunks = chunkVisits([big])
    expect(chunks.map((chunk) => chunk[0]?.events.length)).toEqual([CHUNK_EVENTS, CHUNK_EVENTS, 5])
    expect(new Set(chunks.flat().map((v) => v.id))).toEqual(new Set(['giant']))

    const storage = memoryStorage()
    await storage.migrate()
    const ctx = createContext({ storage, now: () => T0 + 86_400_000 })
    const { site } = await createSite(ctx, { domain: 'example.com' })
    for (const chunk of chunks) await importVisits(ctx, site, 'umami', chunk)
    const sessions = await storage.query<{ pageviews: number; exit_page: string }>(
      'SELECT pageviews, exit_page FROM sessions',
    )
    expect(sessions).toEqual([{ pageviews: CHUNK_EVENTS * 2 + 5, exit_page: `/p${CHUNK_EVENTS * 2 + 4}` }])
    await storage.close?.()
  })
})

describe('prepareImport', () => {
  it('names a file that is not the chosen source, a missing table and a missing column', () => {
    const sa = { name: 'sa.csv', parts: { rows: [{ added_iso: 'x', path: '/', datapoint: 'pageview' }] } }
    expect(() => prepareImport('umami', [sa])).toThrow('sa.csv is not an Umami export')
    expect(() =>
      prepareImport('umami', [{ name: 's.csv', parts: { rows: [{ session_id: 's', browser: 'chrome' }] } }]),
    ).toThrow('no Umami events found')
    expect(() =>
      prepareImport('umami', [{ name: 'e.csv', parts: { rows: [{ event_type: '1', url_path: '/' }] } }]),
    ).toThrow('lacks the column created_at, session_id')
    expect(() => prepareImport('simple-analytics', [{ name: 'x.csv', parts: { rows: [{ added_iso: 'x' }] } }])).toThrow(
      ImportFileError,
    )
    expect(() => prepareImport('simple-analytics', [{ name: 'x.csv', parts: { rows: [] } }])).toThrow('no rows found')
  })

  it('reads a JSON object keyed by table name', () => {
    const { visits } = prepareImport('umami', [
      {
        name: 'umami.json',
        parts: {
          website_event: [
            { session_id: 's', visit_id: 'v', created_at: '2026-03-10T09:00:00Z', url_path: '/', event_type: 1 },
          ],
          session: [{ session_id: 's', browser: 'chrome', country: 'SK' }],
        },
      },
    ])
    expect(visits).toHaveLength(1)
    expect(visits[0]).toMatchObject({ browser: 'Chrome', country: 'SK' })
  })
})
