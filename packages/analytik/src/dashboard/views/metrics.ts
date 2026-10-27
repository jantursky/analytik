import type { Overview, TimeseriesPoint } from '../../shared/types'
import { formatDuration, formatInteger, formatMoney, formatMoneyShort, formatNumber, formatPercent } from '../format'

/** A number the overview can show on a tile and plot over time. */
export type MetricKey = keyof Omit<TimeseriesPoint, 'ts'>

/** How a metric is drawn on its own: counts as an area, money and durations as bars, rates as a line. */
export type ChartKind = 'area' | 'line' | 'bars'

export interface Metric {
  label: string
  kind: ChartKind
  unit: 'count' | 'money' | 'percent' | 'duration'
  /** Lower is better, so a fall shows green. */
  invert?: boolean
}

export const METRICS: Record<MetricKey, Metric> = {
  visitors: { label: 'Visitors', kind: 'area', unit: 'count' },
  sessions: { label: 'Sessions', kind: 'area', unit: 'count' },
  pageviews: { label: 'Pageviews', kind: 'area', unit: 'count' },
  revenue: { label: 'Revenue', kind: 'bars', unit: 'money' },
  orders: { label: 'Orders', kind: 'bars', unit: 'count' },
  conversionRate: { label: 'Conversion rate', kind: 'line', unit: 'percent' },
  revenuePerVisitor: { label: 'Revenue per visitor', kind: 'line', unit: 'money' },
  bounceRate: { label: 'Bounce rate', kind: 'line', unit: 'percent', invert: true },
  avgDurationMs: { label: 'Visit duration', kind: 'bars', unit: 'duration' },
}

export const METRIC_KEYS = Object.keys(METRICS) as MetricKey[]

/** A tile of the summary: a metric, or the visitors online now. */
export type StatKey = MetricKey | 'online'

export const STAT_KEYS: readonly StatKey[] = [...METRIC_KEYS, 'online']

export const statLabel = (key: StatKey): string => (key === 'online' ? 'Live now' : METRICS[key].label)

/** How a metric reads on a tile and the chart axis: money and counts compact from 10,000 up. */
export function formatMetric(key: MetricKey, currency: string): (value: number) => string {
  switch (METRICS[key].unit) {
    case 'money':
      return (value) => formatMoneyShort(value, currency)
    case 'percent':
      return formatPercent
    case 'duration':
      return formatDuration
    default:
      return formatNumber
  }
}

/** A metric with every digit, for the tooltip of a shortened tile. */
export function exactMetric(key: MetricKey, currency: string): (value: number) => string {
  const unit = METRICS[key].unit
  if (unit === 'money') return (value) => formatMoney(value, currency)
  return unit === 'count' ? formatInteger : formatMetric(key, currency)
}

/** The overview's number for a metric, with its change. */
export const overviewDelta = (overview: Overview, key: MetricKey) => overview[key]

/** What the summary block shows: its tiles in order and the metrics its chart combines. */
export interface SummaryConfig {
  stats: StatKey[]
  /** Plotted together, 1 to `MAX_SERIES`, in this order; the order sets each one's colour. */
  chart: MetricKey[]
}

export const DEFAULT_SUMMARY: SummaryConfig = {
  stats: ['visitors', 'revenue', 'conversionRate', 'revenuePerVisitor', 'bounceRate', 'avgDurationMs', 'online'],
  chart: ['visitors', 'revenue'],
}

export const MAX_STATS = 8
/** More than four lines over each other stop being readable, and there are four series colours. */
export const MAX_SERIES = 4

/** The colour of the nth series in a chart, also used for its marker on the tile. */
export const seriesColour = (index: number): string => `var(--analytik-series-${(index % MAX_SERIES) + 1})`

const isMetric = (value: unknown): value is MetricKey => typeof value === 'string' && value in METRICS
const isStat = (value: unknown): value is StatKey => value === 'online' || isMetric(value)
const unique = <T>(key: T, index: number, all: T[]): boolean => all.indexOf(key) === index

/**
 * A saved summary configuration, cleaned up: unknown or repeated entries dropped, missing parts from the default. An
 * older save with a `primary` and a `secondary` series becomes a chart of those two.
 */
export function parseSummary(value: unknown): SummaryConfig {
  const saved = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const stats = Array.isArray(saved.stats) ? saved.stats.filter(isStat).filter(unique).slice(0, MAX_STATS) : []
  const listed = Array.isArray(saved.chart) ? saved.chart : [saved.primary, saved.secondary]
  const chart = listed.filter(isMetric).filter(unique).slice(0, MAX_SERIES)
  return {
    stats: stats.length ? stats : [...DEFAULT_SUMMARY.stats],
    chart: chart.length ? chart : [...DEFAULT_SUMMARY.chart],
  }
}
