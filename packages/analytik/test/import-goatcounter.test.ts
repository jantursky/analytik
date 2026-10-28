import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseCsv } from '../src/shared/import/csv'
import { mapGoatCounter } from '../src/shared/import/goatcounter'
import { prepareImport } from '../src/shared/import/prepare'

const rows = parseCsv(readFileSync(join(import.meta.dirname, 'fixtures/import/goatcounter.csv'), 'utf8'))

describe('goatcounter mapper', () => {
  it('rebuilds visits from sessions and 30-minute gaps', () => {
    const { visits } = mapGoatCounter(rows)
    expect(visits.map((visit) => visit.events.map((event) => event.path))).toEqual([
      ['/', '/pricing', '/signup'],
      ['/'],
      ['/blog'],
    ])
    expect(visits[0]).toMatchObject({
      visitor: 's1',
      startedAt: Date.UTC(2026, 2, 10, 9),
      referrer: 'https://news.example.org',
      country: 'SK',
      region: 'BL',
      browser: 'Chrome',
      os: 'Mac OS',
      device: 'Desktop',
    })
    expect(visits[0]?.events[2]).toMatchObject({ type: 'goal', name: '/signup' })
    expect(visits[2]).toMatchObject({ utmSource: 'newsletter', referrer: null, device: 'Mobile', os: 'iOS' })
  })

  it('skips robots and rows without a date, and checks the columns', () => {
    expect(mapGoatCounter(rows).skipped).toEqual([
      { row: 6, reason: 'a robot' },
      { row: 7, reason: 'Date is missing or not a date' },
    ])
    expect(() => prepareImport('goatcounter', [{ name: 'x.csv', parts: { rows: [{ Path: '/' }] } }])).toThrow(
      'lacks the column date',
    )
    expect(() => prepareImport('goatcounter', [{ name: 'x.csv', parts: { rows: [] } }])).toThrow('no hits found')
    expect(prepareImport('goatcounter', [{ name: 'x.csv', parts: { rows } }]).visits).toHaveLength(3)
  })
})
