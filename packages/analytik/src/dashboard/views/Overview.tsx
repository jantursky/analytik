import { motion } from 'motion/react'

import type { Overview as OverviewData, TimeseriesPoint } from '../../shared/types'
import { AreaChart } from '../charts'
import { requestKey, useDashboard } from '../context'
import { useResource } from '../data'
import { formatBucket, formatDuration, formatMoney, formatNumber, formatPercent } from '../format'
import { StatTile, Status } from '../ui'
import { AnimatedNumber, rise, View } from '../ui/motion'
import { BreakdownCard } from './Breakdown'

/** Loads the overview numbers and the timeseries for the current query. */
export function useOverview() {
  const { client, site, query } = useDashboard()
  const overview = useResource<OverviewData>(requestKey('overview', site.id, query), () =>
    client.overview(site.id, query),
  )
  const series = useResource<TimeseriesPoint[]>(requestKey('timeseries', site.id, query), () =>
    client.timeseries(site.id, query),
  )
  return { overview, series }
}

// Chart series colours; the stat tiles use the same ones as legend markers.
const VISITORS = 'var(--analytik-series-1)'
const REVENUE = 'var(--analytik-series-2)'

export function Overview() {
  const { site, range, openView } = useDashboard()
  const { overview, series } = useOverview()
  const data = overview.data
  const points = series.data ?? []
  const money = (v: number): string => formatMoney(v, data?.currency ?? site.currency)

  return (
    <View>
      <motion.section className="analytik-card analytik-overview" aria-label="Summary" variants={rise}>
        <Status loading={overview.loading && !data} error={overview.error}>
          {data && (
            <div className="analytik-stats">
              <StatTile label="Visitors" delta={data.visitors} format={formatNumber} marker={VISITORS} />
              <StatTile label="Revenue" delta={data.revenue} format={money} marker={REVENUE} />
              <StatTile label="Conversion rate" delta={data.conversionRate} format={formatPercent} />
              <StatTile label="Revenue per visitor" delta={data.revenuePerVisitor} format={money} />
              <StatTile label="Bounce rate" delta={data.bounceRate} format={formatPercent} invert />
              <StatTile label="Session time" delta={data.avgDurationMs} format={formatDuration} />
              <div className="analytik-stat">
                <span className="analytik-stat-label">
                  <span className="analytik-live-dot" data-idle={data.online ? undefined : ''} aria-hidden="true" />
                  Online
                </span>
                <span className="analytik-stat-value">
                  <AnimatedNumber value={data.online} format={formatNumber} />
                </span>
                {openView && (
                  <button type="button" className="analytik-link" onClick={() => openView('realtime')}>
                    View on map
                  </button>
                )}
              </div>
            </div>
          )}
        </Status>
        <Status loading={series.loading && !series.data} error={series.error}>
          <AreaChart
            label="Visitors"
            points={points.map((p) => ({ ts: p.ts, value: p.visitors }))}
            formatValue={formatNumber}
            formatTime={(ts) => formatBucket(ts, range.interval, site.timezone)}
            secondary={{ label: 'Revenue', values: points.map((p) => p.revenue), formatValue: money }}
            height={260}
          />
        </Status>
      </motion.section>
      <div className="analytik-grid">
        <BreakdownCard title="Sources" dimensions={['channel', 'referrer', 'campaign', 'term']} limit={8} />
        <BreakdownCard title="Locations" dimensions={['country', 'region', 'city']} limit={8} />
        <BreakdownCard title="Pages" dimensions={['page', 'entry', 'exit', 'outbound']} limit={8} />
        <BreakdownCard title="Technology" dimensions={['browser', 'os', 'device']} limit={8} />
        <BreakdownCard title="Goals" dimensions={['goal', 'event']} limit={8} />
      </div>
    </View>
  )
}
