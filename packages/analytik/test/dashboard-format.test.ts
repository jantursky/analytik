import { afterEach, describe, expect, it } from 'vitest'

import { niceMax } from '../src/dashboard/scale'
import { DEFAULT_SUMMARY, formatMetric, METRIC_KEYS, parseSummary, statLabel } from '../src/dashboard/views/metrics'
import {
  countryName,
  flagEmoji,
  formatAgo,
  formatBucket,
  formatChange,
  formatDateTime,
  DEFAULT_FORMAT,
  formatDayRange,
  formatDuration,
  formatMoney,
  formatMoneyShort,
  formatNumber,
  formatPercent,
  parseFormatSettings,
  setFormatSettings,
} from '../src/dashboard/format'
import { groupPlaces, landCells, project } from '../src/dashboard/map'
import { customRange, intervalFor, intervalsFor, presetRange, shiftRange, toDateInput } from '../src/dashboard/range'
import { DEFAULT_LAYOUT, moveItem, parseLayout } from '../src/dashboard/views/Overview'
import { describeEvent } from '../src/dashboard/views/Realtime'
import { buildCampaignUrl, buildSnippet } from '../src/dashboard/snippet'
import { visit } from './dashboard-fixtures'

describe('format', () => {
  it('formats numbers, money, percentages, durations and changes', () => {
    expect([formatNumber(1234), formatNumber(12345), formatNumber(-15300)]).toEqual(['1,234', '12.3K', '-15.3K'])
    expect([formatMoney(129900, 'EUR'), formatMoney(500, 'JPY'), formatMoney(1234, 'XXXX')]).toEqual([
      '€1,299.00',
      '¥500',
      '12 XXXX',
    ])
    expect([formatPercent(0.0108), formatPercent(0.42), formatPercent(0)]).toEqual(['1.1%', '42%', '0%'])
    expect([formatDuration(400), formatDuration(45000), formatDuration(83000), formatDuration(3723000)]).toEqual([
      '0s',
      '45s',
      '1m 23s',
      '1h 02m',
    ])
    expect([formatChange(0.2), formatChange(-0.054), formatChange(0), formatChange(null)]).toEqual([
      '+20%',
      '-5%',
      '0%',
      'new',
    ])
  })

  describe('with formatting settings', () => {
    afterEach(() => setFormatSettings(DEFAULT_FORMAT))
    const ts = Date.UTC(2026, 9, 7, 14, 5)
    const sample = () => [
      formatNumber(1234),
      formatMoney(123456, 'EUR'),
      formatMoney(120000, 'EUR'),
      formatMoneyShort(1234567890, 'USD'),
      formatPercent(0.0525),
      formatDateTime(ts, 'UTC'),
      formatBucket(ts, 'day', 'UTC'),
      formatBucket(ts, 'month', 'UTC'),
      formatDayRange(ts, ts + 2 * 86_400_000),
    ]

    it('defaults to US English', () => {
      expect(sample().map((text) => text.replace(/\s/g, ' '))).toEqual([
        '1,234',
        '€1,234.56',
        '€1,200.00',
        '$12.3M',
        '5.3%',
        'Oct 7, 2026, 2:05 PM',
        'Oct 7',
        'Oct 2026',
        'Oct 7 – 9, 2026',
      ])
    })

    it('writes numbers, money and dates the chosen way', () => {
      setFormatSettings({ numbers: 'dot', currency: 'code', cents: 'auto', date: 'dmy', time: '24h' })
      expect(sample().map((text) => text.replace(/\s/g, ' '))).toEqual([
        '1.234',
        '1.234,56 EUR',
        '1.200 EUR',
        '12,3 Mio. USD',
        '5,3 %',
        '07.10.2026 14:05',
        '07.10.',
        '10.2026',
        '07.10.2026 – 09.10.2026',
      ])
      setFormatSettings({ ...DEFAULT_FORMAT, date: 'iso', numbers: 'apostrophe' })
      expect([formatNumber(1234), formatDateTime(ts, 'UTC'), formatBucket(ts, 'day', 'UTC')]).toEqual([
        "1'234",
        '2026-10-07 2:05 PM',
        '10-07',
      ])
      setFormatSettings({ ...DEFAULT_FORMAT, date: 'gb' })
      expect([formatDateTime(ts, 'UTC'), formatDayRange(ts, ts)]).toEqual(['7 Oct 2026, 2:05 PM', '7 Oct 2026'])
      setFormatSettings({ ...DEFAULT_FORMAT, date: 'mdy' })
      expect([formatDateTime(ts, 'UTC'), formatBucket(ts, 'month', 'UTC')]).toEqual(['10/07/2026 2:05 PM', '10/2026'])
    })

    it('replaces unknown saved values with the default', () => {
      expect(parseFormatSettings(undefined)).toEqual(DEFAULT_FORMAT)
      expect(parseFormatSettings({ numbers: 'space', date: 'nope', time: 24 })).toEqual({
        ...DEFAULT_FORMAT,
        numbers: 'space',
      })
    })
  })

  it('formats dates in a time zone', () => {
    const ts = Date.UTC(2026, 9, 27, 14, 30)
    expect(formatBucket(ts, 'hour', 'UTC')).toBe('2:30 PM')
    expect(formatBucket(ts, 'day', 'UTC')).toBe('Oct 27')
    expect(formatBucket(ts, 'week', 'UTC')).toBe('Oct 27')
    expect(formatBucket(ts, 'month', 'UTC')).toBe('Oct 2026')
    expect(formatDateTime(ts, 'UTC')).toBe('Oct 27, 2026, 2:30 PM')
    expect([
      formatAgo(ts - 5000, ts),
      formatAgo(ts - 600000, ts),
      formatAgo(ts - 7200000, ts),
      formatAgo(ts + 1, ts),
    ]).toEqual(['5s ago', '10m ago', '2h ago', '0s ago'])
  })
})

describe('range', () => {
  const now = new Date(2026, 9, 27, 15, 45).getTime()

  it('computes preset ranges ending now', () => {
    expect(presetRange('today', now)).toEqual({
      preset: 'today',
      from: new Date(2026, 9, 27).getTime(),
      to: now,
      interval: 'hour',
    })
    expect(presetRange('24h', now)).toMatchObject({ from: now - 86400000, interval: 'hour' })
    expect(presetRange('7d', now)).toMatchObject({ from: new Date(2026, 9, 21).getTime(), interval: 'day' })
    expect(presetRange('30d', now)).toMatchObject({ from: new Date(2026, 8, 28).getTime(), interval: 'day' })
    expect(presetRange('90d', now)).toMatchObject({ from: new Date(2026, 6, 30).getTime(), interval: 'day' })
    expect(presetRange('12m', now)).toMatchObject({ from: new Date(2025, 9, 1).getTime(), interval: 'month' })
  })

  it('builds custom ranges including both days', () => {
    expect(customRange('2026-10-01', '2026-10-01')).toEqual({
      preset: 'custom',
      from: new Date(2026, 9, 1).getTime(),
      to: new Date(2026, 9, 2).getTime(),
      interval: 'hour',
    })
    expect(customRange('2026-01-01', '2026-12-31')?.interval).toBe('week')
    expect(customRange('2026-10-02', '2026-10-01')).toBeNull()
    expect(customRange('', '2026-10-01')).toBeNull()
    expect(intervalFor(0, 500 * 86400000)).toBe('month')
    expect(toDateInput(new Date(2026, 0, 5).getTime())).toBe('2026-01-05')
  })

  it('steps to the previous and next period of the same length', () => {
    const day = 86400000
    const today = presetRange('today', now)
    expect(shiftRange(today, -1, now)).toEqual({
      preset: 'custom',
      from: today.from - day,
      to: today.from,
      interval: 'hour',
    })
    expect(shiftRange(today, 1, now)).toBeNull()
    const last24h = presetRange('24h', now)
    expect(shiftRange(last24h, -1, now)).toMatchObject({ from: now - 2 * day, to: now - day })
    const week = presetRange('7d', now)
    const previous = shiftRange(week, -1, now)
    expect(previous).toMatchObject({ from: week.from - 7 * day, to: week.from, interval: 'day' })
    expect(previous && shiftRange(previous, 1, now)).toMatchObject({ from: week.from, to: now })
  })

  it('offers the intervals that suit a range', () => {
    const day = 86400000
    expect(intervalsFor(0, day)).toEqual(['hour', 'day'])
    expect(intervalsFor(0, 30 * day)).toEqual(['day', 'week'])
    expect(intervalsFor(0, 90 * day)).toEqual(['day', 'week', 'month'])
    expect(intervalsFor(0, 500 * day)).toEqual(['week', 'month'])
  })
})

describe('places and the map', () => {
  it('names countries and draws their flags', () => {
    expect(countryName('DE')).toBe('Germany')
    expect(countryName('XX')).toBe('XX')
    expect(countryName('unknown')).toBe('unknown')
    expect(flagEmoji('SK')).toBe('🇸🇰')
    expect(flagEmoji('')).toBe('')
  })

  it('groups locations and projects them flat or on a globe', () => {
    const places = groupPlaces([
      visit({ lat: 48.15, lon: 17.11, country: 'SK', city: 'Bratislava' }, 's1', '/'),
      visit({ lat: 0, lon: 0, country: null, city: null }, 's2', '/'),
      visit({ lat: 48.15, lon: 17.11, country: 'SK', city: 'Bratislava' }, 's3', '/'),
      visit({ lat: 10, lon: 20, country: null, city: null }, 's4', '/'),
    ])
    expect(places.map((p) => [p.label, p.count, p.known])).toEqual([
      ['Bratislava, Slovakia', 2, true],
      ['Unknown location', 1, false],
      ['Unknown location', 1, true],
    ])
    expect(project([0, 0])).toEqual([180, 84])
    expect(project([0, 0], [0, 0])).toEqual([180, 72])
    expect(project([180, 0], [0, 0])).toBeNull()
    expect(landCells().length).toBeGreaterThan(1500)
    expect(landCells()).toBe(landCells())
  })

  it('describes realtime events', () => {
    const event = { ts: 0, name: null, path: '/a', country: 'FR' }
    const line = (type: Parameters<typeof describeEvent>[0]['type'], name: string | null = null) =>
      Object.values(describeEvent({ ...event, type, name })).join(' ')
    expect(line('pageview')).toBe('Visitor from France visited /a')
    expect(line('goal', 'signup')).toBe('Visitor from France completed signup')
    expect(line('revenue', 'purchase')).toBe('Visitor from France paid on /a')
    expect(line('outbound', 'https://x.org')).toBe('Visitor from France left for https://x.org')
    expect(line('ping')).toBe('Visitor from France is reading /a')
    expect(line('identify')).toBe('Visitor from France signed in on /a')
    expect(describeEvent({ ...event, country: null, path: null, type: 'pageview' })).toEqual({
      who: 'A visitor',
      action: 'visited',
      target: '',
    })
  })
})

describe('snippet', () => {
  it('leaves out defaults', () => {
    expect(
      buildSnippet({
        site: 'site_1',
        apiUrl: 'https://stats.example.net/api',
        mode: 'strict',
        requireInteraction: true,
        autoOutbound: true,
        keepQuery: ' ',
        pingInterval: 240,
        debug: false,
      }),
    ).toBe('<script defer src="https://stats.example.net/js/analytik.js" data-site="site_1"></script>')
  })

  it('writes every non-default option, escaped', () => {
    expect(
      buildSnippet({
        site: 'a"b',
        apiUrl: 'https://example.com/stats/api/',
        mode: 'persistent',
        requireInteraction: false,
        autoOutbound: false,
        keepQuery: 'page,tab',
        pingInterval: 0,
        debug: true,
      }),
    ).toBe(
      '<script defer src="https://example.com/js/analytik.js" data-site="a&quot;b" data-api="https://example.com/stats/api" data-mode="persistent" data-require-interaction="false" data-auto-outbound="false" data-keep-query="page,tab" data-ping-interval="0" data-debug="true"></script>',
    )
  })

  it('builds campaign links', () => {
    expect(
      buildCampaignUrl(' https://example.com/p?utm_term=old&x=1 ', {
        source: 'news',
        medium: ' email ',
        campaign: 'launch',
        term: '',
      }),
    ).toBe('https://example.com/p?x=1&utm_source=news&utm_medium=email&utm_campaign=launch')
    expect(buildCampaignUrl('example.com', { source: 'x' })).toBeNull()
    expect(buildCampaignUrl('ftp://example.com', { source: 'x' })).toBeNull()
  })
})

describe('niceMax', () => {
  it('rounds up to a readable axis maximum', () => {
    expect([niceMax(0), niceMax(7), niceMax(180), niceMax(230), niceMax(4100), niceMax(10)]).toEqual([
      1, 10, 200, 250, 5000, 10,
    ])
  })
})

describe('overview layout', () => {
  it('keeps known blocks once, falls back to the default and moves within bounds', () => {
    expect(parseLayout(null)).toEqual(DEFAULT_LAYOUT)
    expect(parseLayout('not json')).toEqual(DEFAULT_LAYOUT)
    expect(parseLayout('{"id":"pages"}')).toEqual(DEFAULT_LAYOUT)
    const stored = parseLayout(
      JSON.stringify([{ id: 'goals', wide: true, hidden: 'yes' }, { id: 'planets' }, { id: 'goals' }, null, 4]),
    )
    expect(stored).toEqual([{ id: 'goals', wide: true }])
    expect(parseLayout('[{"id":"funnel"},{"id":"kpis","wide":true}]')).toEqual([
      { id: 'funnel', wide: false },
      { id: 'kpis', wide: true },
    ])
    expect(parseLayout('[]')).toEqual(DEFAULT_LAYOUT)
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c'])
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
    expect(moveItem(['a', 'b', 'c'], 2, 5)).toEqual(['a', 'b', 'c'])
  })
})

describe('summary settings', () => {
  it('keeps known numbers once and falls back to the default chart', () => {
    expect(parseSummary(undefined)).toEqual(DEFAULT_SUMMARY)
    expect(parseSummary({ stats: [], primary: 'nope' })).toEqual(DEFAULT_SUMMARY)
    expect(
      parseSummary({
        stats: ['orders', 'orders', 'planets', 'online'],
        chart: ['revenue', 'revenue', 'planets', 'orders'],
      }),
    ).toEqual({ stats: ['orders', 'online'], chart: ['revenue', 'orders'] })
    expect(parseSummary({ chart: METRIC_KEYS }).chart).toEqual(METRIC_KEYS.slice(0, 4))
    // Saved before the chart could combine more than two metrics.
    expect(parseSummary({ primary: 'sessions', secondary: null }).chart).toEqual(['sessions'])
    expect(parseSummary({ primary: 'revenue', secondary: 'revenue' }).chart).toEqual(['revenue'])
    expect(parseSummary({ stats: [...METRIC_KEYS, 'online'] }).stats).toHaveLength(8)
  })

  it('formats each metric by its unit', () => {
    expect(formatMetric('revenue', 'EUR')(1250)).toBe('€12.50')
    expect(formatMetric('bounceRate', 'EUR')(0.42)).toBe('42%')
    expect(formatMetric('avgDurationMs', 'EUR')(83000)).toBe('1m 23s')
    expect(formatMetric('visitors', 'EUR')(1200)).toBe('1,200')
    expect(statLabel('online')).toBe('Live now')
  })
})
