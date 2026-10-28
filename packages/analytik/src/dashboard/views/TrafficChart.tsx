import type { TimeseriesPoint } from '../../shared/types'
import { AreaChart } from '../charts'
import { useDashboard } from '../context'
import { ComparisonNote } from './ComparisonNote'
import { msg, t } from '../i18n'
import { formatBucket, formatInteger, formatMoney, formatMoneyShort, formatNumber } from '../format'

export type SeriesMetric = 'visitors' | 'sessions' | 'pageviews' | 'revenue'

export const SERIES_LABELS: Record<SeriesMetric, string> = {
  visitors: msg('Visitors'),
  sessions: msg('Sessions'),
  pageviews: msg('Pageviews'),
  revenue: msg('Revenue'),
}

/** The timeseries of one metric for the dashboard range. */
export function TrafficChart({ points, metric }: { points: TimeseriesPoint[]; metric: SeriesMetric }) {
  const { site, range } = useDashboard()
  return (
    <>
      <AreaChart
        label={t(SERIES_LABELS[metric])}
        points={points.map((p) => ({
          ts: p.ts,
          value: p[metric],
          ...(p.previous && { previous: p.previous[metric] }),
        }))}
        formatValue={metric === 'revenue' ? (v) => formatMoney(v, site.currency) : formatInteger}
        formatAxis={metric === 'revenue' ? (v) => formatMoneyShort(v, site.currency) : formatNumber}
        formatTime={(ts) => formatBucket(ts, range.interval, site.timezone)}
      />
      <ComparisonNote points={points} />
    </>
  )
}
