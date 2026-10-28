import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseJsonParts } from '../src/shared/import/json'
import { prepareImport } from '../src/shared/import/prepare'

const read = (name: string) => ({
  name,
  parts: parseJsonParts(readFileSync(join(import.meta.dirname, 'fixtures/import', name), 'utf8'), name),
})

describe('json files', () => {
  it('reads a document or newline-delimited JSON, and names a bad file', () => {
    expect(parseJsonParts('[{"a":1}]', 'x')).toEqual({ rows: [{ a: 1 }] })
    expect(parseJsonParts('{"a":1}\n\n{"a":2}\n', 'x')).toEqual({ rows: [{ a: 1 }, { a: 2 }] })
    expect(parseJsonParts('{"events":[]}', 'x')).toEqual({ events: [] })
    expect(() => parseJsonParts('nope', 'x.json')).toThrow('x.json is not valid JSON')
    expect(() => parseJsonParts('5', 'x.json')).toThrow('x.json is not a list of rows')
  })
})

describe('GA4 BigQuery import', () => {
  it('builds a visit per user and session from page views and events', () => {
    const { visits, skipped } = prepareImport('ga4', [read('ga4-events.jsonl')])
    expect(visits).toHaveLength(2)
    expect(visits[0]).toMatchObject({
      visitor: 'u1.1700000000',
      durationMs: 12000,
      hostname: 'example.com',
      referrer: 'https://www.google.com/',
      country: 'SK',
      city: 'Bratislava',
      browser: 'Chrome',
      os: 'Android',
      device: 'Mobile',
    })
    expect(visits[0]?.events.map((event) => [event.type, event.name, event.path])).toEqual([
      ['pageview', null, '/'],
      ['pageview', null, '/pricing'],
      ['goal', 'sign_up', '/pricing'],
    ])
    expect(visits[1]).toMatchObject({ utmSource: 'newsletter', utmMedium: 'email', country: 'DE', os: 'Mac OS' })
    expect(skipped).toEqual([{ file: 'export', row: 6, reason: 'the event has no page_location' }])
  })

  it('names a file that is not the events table', () => {
    expect(() => prepareImport('ga4', [{ name: 'x.json', parts: { rows: [] } }])).toThrow('no events found')
    expect(() => prepareImport('ga4', [{ name: 'x.json', parts: { rows: [{ event_name: 'a' }] } }])).toThrow(
      'lacks the field event_timestamp, user_pseudo_id',
    )
  })
})

describe('PostHog import', () => {
  it('groups by session or silence, reads string properties and ignores PostHog events and the next link', () => {
    const { visits, skipped } = prepareImport('posthog', [read('posthog-events.json')])
    expect(visits.map((visit) => visit.events.map((event) => event.path))).toEqual([
      ['/', '/pricing'],
      ['/blog'],
      ['/docs'],
    ])
    expect(visits[0]).toMatchObject({
      visitor: 'd1',
      hostname: 'example.com',
      referrer: 'https://news.ycombinator.com/',
      utmSource: 'hn',
      country: 'SK',
      os: 'Mac OS',
      device: 'Desktop',
    })
    expect(visits[0]?.events[1]).toMatchObject({ type: 'goal', name: 'signed up' })
    expect(visits[1]).toMatchObject({ referrer: null, device: 'Mobile' })
    expect(skipped).toEqual([
      { file: 'export', row: 6, reason: 'the event has no page' },
      { file: 'export', row: 7, reason: 'event, distinct_id or timestamp is missing' },
    ])
  })

  it('names a file that is not PostHog events', () => {
    expect(() => prepareImport('posthog', [{ name: 'x.json', parts: { rows: [{ event: 'a' }] } }])).toThrow(
      'lacks the field distinct_id, timestamp',
    )
  })
})
