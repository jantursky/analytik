import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { mapMatomo } from '../src/shared/import/matomo'
import { prepareImport } from '../src/shared/import/prepare'

const rows = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures/import/matomo-visits.json'), 'utf8'),
) as Record<string, unknown>[]

describe('matomo mapper', () => {
  it('maps visits, pages, events and goals', () => {
    const { visits } = mapMatomo(rows)
    expect(visits).toHaveLength(2)
    expect(visits[0]).toMatchObject({
      id: '101',
      visitor: '0a1b2c3d4e5f6071',
      startedAt: 1773133200000,
      durationMs: 95000,
      hostname: 'example.com',
      referrer: 'https://www.google.com/',
      country: 'SK',
      browser: 'Chrome',
      os: 'Mac OS',
      device: 'Mobile',
    })
    expect(visits[0]?.events).toEqual([
      { ts: 1773133200000, type: 'pageview', name: null, path: '/' },
      { ts: 1773133260000, type: 'pageview', name: null, path: '/pricing' },
      {
        ts: 1773133295000,
        type: 'goal',
        name: 'signup',
        path: '/pricing',
        props: { category: 'conversion', name: 'pro', value: '12' },
      },
    ])
    expect(visits[1]).toMatchObject({
      durationMs: null,
      referrer: null,
      utmSource: 'newsletter',
      utmMedium: 'email',
      utmCampaign: 'launch',
      os: 'Windows',
      device: 'Desktop',
    })
    expect(visits[1]?.events.at(-1)).toMatchObject({ type: 'goal', name: 'Newsletter' })
  })

  it('counts what it cannot use', () => {
    expect(mapMatomo(rows).skipped).toEqual([
      { row: 1, reason: 'a download action is not supported' },
      { row: 3, reason: 'the visit has no page views, events or goals' },
      { row: 4, reason: 'idVisit or actionDetails is missing' },
    ])
  })

  it('names a file that is not a Matomo visits export', () => {
    const file = (parts: Record<string, Record<string, unknown>[]>) => [{ name: 'x.json', parts }]
    expect(() => prepareImport('matomo', file({ rows: [] }))).toThrow('no visits found')
    expect(() => prepareImport('matomo', file({ rows: [{ idVisit: '1' }] }))).toThrow('lacks the field actionDetails')
    expect(prepareImport('matomo', file({ rows })).visits).toHaveLength(2)
  })
})
