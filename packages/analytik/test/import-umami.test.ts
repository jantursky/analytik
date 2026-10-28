import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createContext } from '../src/server/context'
import { importVisits } from '../src/server/import/core'
import { createSite } from '../src/server/sites'
import { createCsvReader, parseCsv } from '../src/shared/import/csv'
import { normalizeCountry, parseTimestamp, pathOf } from '../src/shared/import/normalize'
import { detectUmamiTable, mapUmami } from '../src/shared/import/umami'
import { memoryStorage } from '../src/storage/memory'

const fixture = (name: string) => parseCsv(readFileSync(join(import.meta.dirname, 'fixtures/import', name), 'utf8'))

describe('csv reader', () => {
  it('reads quotes, doubled quotes, embedded newlines, CRLF, a BOM and blank lines', () => {
    const text = '﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n"two\nlines",z'
    expect(parseCsv(text)).toEqual([
      { a: 'x, y', b: 'say "hi"' },
      { a: 'two\nlines', b: 'z' },
    ])
  })

  it('gives the same records when the text arrives in tiny pieces', () => {
    const text = 'a,b\n"q""uo\nte",2\n3,4'
    const reader = createCsvReader()
    const records = Array.from({ length: text.length }, (_, index) => text.charAt(index))
      .flatMap((char) => reader.push(char))
      .concat(reader.end())
    expect(records).toEqual(parseCsv(text))
    expect(records).toHaveLength(2)
  })
})

describe('normalisers', () => {
  it('reads the timestamps exports hold', () => {
    const expected = Date.UTC(2026, 2, 10, 9, 0, 0, 123)
    expect(parseTimestamp('2026-03-10 09:00:00.123+00')).toBe(expected)
    expect(parseTimestamp('2026-03-10T09:00:00.123Z')).toBe(expected)
    expect(parseTimestamp('2026-03-10T10:00:00.123+01:00')).toBe(expected)
    expect(parseTimestamp('2026-03-10 09:00:00.123')).toBe(expected)
    expect(parseTimestamp(String(expected))).toBe(expected)
    expect(parseTimestamp('1773133200')).toBe(Date.UTC(2026, 2, 10, 9))
    expect(parseTimestamp('nope')).toBeNull()
  })

  it('reads country codes and names, and paths from paths and URLs', () => {
    expect(normalizeCountry('sk')).toBe('SK')
    expect(normalizeCountry('Germany')).toBe('DE')
    expect(normalizeCountry('Atlantis')).toBeNull()
    expect(pathOf('/pricing/?a=1#x')).toBe('/pricing')
    expect(pathOf('https://example.com/a//b/')).toBe('/a/b')
    expect(pathOf('')).toBeNull()
  })
})

describe('umami mapper', () => {
  const events = fixture('umami-events.csv')
  const sessions = fixture('umami-sessions.csv')
  const eventData = fixture('umami-event-data.csv')

  it('recognises the three tables from their columns', () => {
    expect(detectUmamiTable(Object.keys(events[0]!))).toBe('events')
    expect(detectUmamiTable(Object.keys(sessions[0]!))).toBe('sessions')
    expect(detectUmamiTable(Object.keys(eventData[0]!))).toBe('eventData')
    expect(detectUmamiTable(['foo', 'bar'])).toBeNull()
  })

  it('maps pageviews and custom events to visits with the session as visitor', () => {
    const { visits, skipped } = mapUmami({ events, sessions, eventData })
    const byId = Object.fromEntries(visits.map((visit) => [visit.id, visit]))
    expect(Object.keys(byId).sort()).toEqual(['v1', 'v2', 'v3'])
    expect(skipped).toHaveLength(4)

    expect(byId.v1).toMatchObject({
      visitor: 's1',
      startedAt: Date.UTC(2026, 2, 10, 9),
      durationMs: 25_000,
      hostname: 'www.example.com',
      referrer: null,
      utmSource: 'newsletter',
      utmMedium: 'email',
      utmCampaign: 'march',
      country: 'SK',
      region: 'SK-BL',
      city: 'Bratislava',
      browser: 'Chrome',
      os: 'Mac OS',
      device: 'Desktop',
    })
    expect(byId.v1?.events.map((e) => [e.type, e.name, e.path])).toEqual([
      ['pageview', null, '/'],
      ['pageview', null, '/pricing'],
      ['goal', 'signup', '/pricing'],
    ])
    expect(byId.v1?.events[2]).toMatchObject({ id: 'e3', props: { plan: 'pro', seats: 5 } })

    expect(byId.v2).toMatchObject({
      referrer: 'https://news.ycombinator.com/item?id=1',
      country: 'DE',
      browser: 'Mobile Safari',
      os: 'iOS',
      device: 'Mobile',
    })
    expect(byId.v3).toMatchObject({ browser: 'Edge', os: 'Windows', device: 'Desktop', durationMs: null })
  })

  it('skips bad rows and says why, without stopping', () => {
    const { skipped, visits } = mapUmami({ events, sessions })
    expect(skipped).toEqual([
      { table: 'events', row: 5, reason: 'event_type 3 is not supported' },
      { table: 'events', row: 6, reason: 'created_at is missing or not a date' },
      { table: 'events', row: 7, reason: 'session_id is missing' },
      { table: 'events', row: 8, reason: 'url_path is missing' },
    ])
    expect(visits.flatMap((visit) => visit.events)).toHaveLength(5)
  })

  it('leaves fields it was not given empty rather than guessing', () => {
    const { visits } = mapUmami({ events })
    expect(visits[0]).toMatchObject({ browser: null, os: null, device: null, country: null })
  })

  it('splits exports without visit_id by session on 30 minutes of silence', () => {
    const rows = [
      { session_id: 's', created_at: '2026-03-10T09:00:00Z', url_path: '/' },
      { session_id: 's', created_at: '2026-03-10T09:10:00Z', url_path: '/a' },
      { session_id: 's', created_at: '2026-03-10T11:00:00Z', url_path: '/b' },
    ]
    const { visits } = mapUmami({ events: rows })
    expect(visits.map((visit) => visit.events.length)).toEqual([2, 1])
    expect(new Set(visits.map((visit) => visit.id)).size).toBe(2)
  })

  it('accepts camelCase column names, as in JSON exports', () => {
    const { visits } = mapUmami({
      events: [{ sessionId: 's', visitId: 'v', createdAt: '2026-03-10T09:00:00Z', urlPath: '/x', eventType: 1 }],
    })
    expect(visits).toHaveLength(1)
    expect(visits[0]?.events[0]?.path).toBe('/x')
  })
})

describe('umami import end to end', () => {
  it('stores the fixture, finds it again on a repeat, and groups by the same breakdown keys as tracked data', async () => {
    const storage = memoryStorage()
    await storage.migrate()
    const ctx = createContext({ storage, now: () => Date.UTC(2026, 2, 16) })
    const { site } = await createSite(ctx, { domain: 'example.com' })
    const { visits } = mapUmami({
      events: fixture('umami-events.csv'),
      sessions: fixture('umami-sessions.csv'),
      eventData: fixture('umami-event-data.csv'),
    })

    expect(await importVisits(ctx, site, 'umami', visits)).toMatchObject({ visits: 3, events: 5 })
    expect(await importVisits(ctx, site, 'umami', visits)).toMatchObject({
      visits: 0,
      events: 0,
      existing: { visits: 3, events: 5 },
    })
    const rows = await storage.query<{ browser: string; os: string; device: string; source: string; channel: string }>(
      'SELECT browser, os, device, source, channel FROM sessions ORDER BY started_at',
    )
    expect(rows).toEqual([
      { browser: 'Chrome', os: 'Mac OS', device: 'Desktop', source: 'Newsletter', channel: 'Email' },
      { browser: 'Mobile Safari', os: 'iOS', device: 'Mobile', source: 'Hacker News', channel: 'Organic Social' },
      { browser: 'Edge', os: 'Windows', device: 'Desktop', source: 'Direct/None', channel: 'Direct' },
    ])
    await storage.close?.()
  })
})
