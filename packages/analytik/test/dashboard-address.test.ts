import { describe, expect, it } from 'vitest'

import { readAddress, writeAddress } from '../src/dashboard/address'
import { customRange, presetRange } from '../src/dashboard/range'

const vocabulary = { views: ['overview', 'pages', 'settings'], tabs: ['general', 'privacy'] }
const now = new Date('2026-10-15T12:00:00').getTime()
const base = new URL('http://localhost/dash')
const write = (state: Parameters<typeof writeAddress>[1], url = base): string => {
  const next = writeAddress(url, state)
  return next.pathname + next.search
}

describe('dashboard address', () => {
  it('leaves defaults out, so a clean link stays clean', () => {
    expect(write({ site: 's1', view: 'overview', range: presetRange('7d', now), filters: {} })).toBe('/dash?site=s1')
  })

  it('keeps the comparison and lets a saved segment stand for its filters', () => {
    const range = presetRange('7d', now)
    const url = new URL(write({ site: 's1', range, compare: 'year', segment: 'abc', filters: { country: 'SK' } }), base)
    expect(url.search).toBe('?site=s1&compare=year&segment=abc')
    expect(readAddress(url.search, vocabulary, now)).toMatchObject({ compare: 'year', segment: 'abc', filters: {} })
    expect(readAddress('?compare=never', vocabulary, now).compare).toBeUndefined()
    // Without a segment the filters are written out as before.
    expect(write({ site: 's1', range, filters: { country: 'SK' } })).toBe('/dash?site=s1&f.country=SK')
  })

  it('round-trips the site, view, tab, preset range, interval and filters', () => {
    const range = { ...presetRange('30d', now), interval: 'week' as const }
    const url = new URL(
      write({ site: 's1', view: 'settings', tab: 'privacy', range, filters: { country: 'SK' } }),
      base,
    )
    expect(url.search).toBe('?site=s1&section=settings&tab=privacy&range=30d&interval=week&f.country=SK')
    const read = readAddress(url.search, vocabulary, now)
    expect(read).toMatchObject({ site: 's1', view: 'settings', tab: 'privacy', filters: { country: 'SK' } })
    expect(read.range).toMatchObject({ preset: '30d', interval: 'week' })
  })

  it('keeps a custom range as dates, or as milliseconds when it does not start at midnight', () => {
    const custom = customRange('2026-10-01', '2026-10-03')!
    const url = new URL(write({ site: 's1', range: custom, filters: {} }), base)
    expect(url.search).toBe('?site=s1&from=2026-10-01&to=2026-10-03')
    expect(readAddress(url.search, vocabulary, now).range).toEqual(custom)
    const odd = { preset: 'custom' as const, from: now - 5000, to: now, interval: 'hour' as const }
    const back = readAddress(new URL(write({ site: 's1', range: odd, filters: {} }), base).search, vocabulary, now)
    expect(back.range).toMatchObject({ preset: 'custom', from: odd.from, to: odd.to })
  })

  it('ignores values it does not know', () => {
    const read = readAddress(
      '?section=nope&tab=nope&range=forever&interval=decade&f.nonsense=1&f.country=DE&from=x&to=y',
      vocabulary,
      now,
    )
    expect(read).toEqual({
      site: undefined,
      view: undefined,
      tab: undefined,
      range: undefined,
      filters: { country: 'DE' },
    })
  })

  it('keeps parameters of the host page and drops a tab outside Settings', () => {
    const url = new URL('http://localhost/dash?utm=1&tab=privacy&f.country=SK')
    expect(write({ site: 's1', view: 'pages', tab: 'privacy', filters: {} }, url)).toBe(
      '/dash?utm=1&site=s1&section=pages',
    )
  })
})
