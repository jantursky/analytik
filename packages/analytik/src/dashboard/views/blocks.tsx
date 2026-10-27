import { motion } from 'motion/react'
import { type ReactNode, useState } from 'react'

import type { BreakdownRow, Funnel, FunnelResult, Page, Payment, Realtime as RealtimeData } from '../../shared/types'
import { requestKey, useDashboard } from '../context'
import { liveSignature, usePolling, useResource } from '../data'
import { formatAgo, formatMoney, formatNumber, formatPercent } from '../format'
import { Icon, type IconName } from '../icons'
import { Card, DeltaBadge, StatTile, Status } from '../ui'
import { AnimatedNumber, EASE, rise } from '../ui/motion'
import { BreakdownCard } from './Breakdown'
import { Visitor } from './cells'
import { exactMetric, formatMetric, METRICS, type MetricKey } from './metrics'
import { SummaryBlock } from './SummaryBlock'
import { useOverview } from './useOverview'
import { describeEvent } from './Realtime'

/** Where a block sits in the picker. */
export type BlockCategory = 'Traffic' | 'Content' | 'Audience' | 'Revenue' | 'Live'

export interface BlockType {
  name: string
  description: string
  category: BlockCategory
  /** Spans both columns when added. */
  wide: boolean
  /** Has its own settings while the overview is customized, so it stays clickable then. */
  configurable?: boolean
  render: (props: BlockProps) => ReactNode
}

export interface BlockProps {
  /** The overview is being customized. */
  editing: boolean
}

const KPI_TILES: readonly { key: MetricKey; icon: IconName }[] = [
  { key: 'visitors', icon: 'visitors' },
  { key: 'pageviews', icon: 'page' },
  { key: 'sessions', icon: 'clock' },
  { key: 'revenue', icon: 'coin' },
]

/** Four headline numbers on their own tiles, each with an icon and its trend over the period. */
function KeyNumbersBlock() {
  const { site } = useDashboard()
  const { overview, series } = useOverview()
  const data = overview.data
  const points = series.data ?? []
  const currency = data?.currency ?? site.currency
  const tiles = KPI_TILES.map(({ key, icon }) => ({
    key,
    icon,
    label: METRICS[key].label,
    format: formatMetric(key, currency),
    exact: exactMetric(key, currency),
    trend: points.map((p) => p[key]),
  }))
  return (
    <motion.section className="analytik-kpis" aria-label="Key numbers" variants={rise}>
      <Status loading={overview.loading && !data} error={overview.error}>
        {data &&
          tiles.map((tile) => (
            <div key={tile.key} className="analytik-card analytik-kpi">
              <span className="analytik-kpi-icon" aria-hidden="true">
                <Icon name={tile.icon} />
              </span>
              <StatTile
                label={tile.label}
                delta={data[tile.key]}
                format={tile.format}
                exact={tile.exact}
                trend={tile.trend}
              />
            </div>
          ))}
      </Status>
    </motion.section>
  )
}

/** Each channel with its visitors, how many converted and what they paid: a table rather than bars. */
function ChannelTableBlock() {
  const { client, site, query, addFilter } = useDashboard()
  const rows = useResource<BreakdownRow[]>(requestKey('breakdown', site.id, 'channel', query), () =>
    client.breakdown(site.id, 'channel', query),
  )
  const list = rows.data ?? []
  return (
    <Card title="Channel performance">
      <Status loading={rows.loading && !rows.data} error={rows.error}>
        {list.length ? (
          <div className="analytik-table-wrap">
            <table className="analytik-table analytik-compact">
              <thead>
                <tr>
                  <th scope="col">Channel</th>
                  <th scope="col" className="analytik-num">
                    Visitors
                  </th>
                  <th scope="col" className="analytik-num">
                    Converted
                  </th>
                  <th scope="col" className="analytik-num">
                    Revenue
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.slice(0, 8).map((row) => (
                  <tr key={row.key}>
                    <td>
                      <button type="button" className="analytik-link-row" onClick={() => addFilter('channel', row.key)}>
                        {row.key || '(none)'}
                      </button>
                    </td>
                    <td className="analytik-num">{formatNumber(row.visitors)}</td>
                    <td className="analytik-num">{formatPercent(row.conversionRate)}</td>
                    <td className="analytik-num">{row.revenue ? formatMoney(row.revenue, site.currency) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="analytik-empty">Nothing recorded in this period</p>
        )}
      </Status>
    </Card>
  )
}

const DONUT_COLOURS = ['var(--analytik-series-1)', 'var(--analytik-series-2)', 'var(--analytik-series-3)']
const RADIUS = 42
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** Visitors by device type as a ring, with the share of each. */
function DeviceSplitBlock() {
  const { client, site, query } = useDashboard()
  const rows = useResource<BreakdownRow[]>(requestKey('breakdown', site.id, 'device', query), () =>
    client.breakdown(site.id, 'device', query),
  )
  const list = (rows.data ?? []).slice(0, 3)
  const total = list.reduce((sum, row) => sum + row.visitors, 0)
  const lengths = list.map((row) => (total ? (row.visitors / total) * CIRCUMFERENCE : 0))
  const starts = lengths.map((_, index) => lengths.slice(0, index).reduce((sum, length) => sum + length, 0))
  return (
    <Card title="Device split">
      <Status loading={rows.loading && !rows.data} error={rows.error}>
        {total ? (
          <div className="analytik-donut">
            <svg viewBox="0 0 100 100" role="img" aria-label="Visitors by device">
              <circle className="analytik-donut-track" cx="50" cy="50" r={RADIUS} />
              {list.map((row, index) => {
                const length = lengths[index] ?? 0
                return (
                  <motion.circle
                    key={row.key}
                    cx="50"
                    cy="50"
                    r={RADIUS}
                    stroke={DONUT_COLOURS[index]}
                    strokeDashoffset={-(starts[index] ?? 0)}
                    initial={{ strokeDasharray: `0 ${CIRCUMFERENCE}` }}
                    animate={{ strokeDasharray: `${Math.max(length - 2, 0)} ${CIRCUMFERENCE}` }}
                    transition={{ duration: 0.7, ease: EASE, delay: index * 0.08 }}
                  />
                )
              })}
            </svg>
            <ul className="analytik-legend-list">
              {list.map((row, index) => (
                <li key={row.key}>
                  <span className="analytik-marker" style={{ background: DONUT_COLOURS[index] }} aria-hidden="true" />
                  {row.key || 'Unknown'}
                  <strong>{formatPercent(row.visitors / total)}</strong>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="analytik-empty">Nothing recorded in this period</p>
        )}
      </Status>
    </Card>
  )
}

/** Revenue divided by orders, against the previous period. */
function OrderValueBlock() {
  const { site } = useDashboard()
  const { overview } = useOverview()
  const data = overview.data
  const value = data?.orders.value ? data.revenue.value / data.orders.value : 0
  const previous = data?.orders.previous ? data.revenue.previous / data.orders.previous : null
  const change = previous ? (value - previous) / previous : null
  return (
    <Card title="Average order value">
      <Status loading={overview.loading && !data} error={overview.error}>
        {data && (
          <div className="analytik-big-number">
            <span className="analytik-kpi-icon" aria-hidden="true">
              <Icon name="coin" />
            </span>
            <strong>{data.orders.value ? formatMoney(Math.round(value), data.currency || site.currency) : '—'}</strong>
            <span className="analytik-muted">
              from {formatNumber(data.orders.value)} {data.orders.value === 1 ? 'order' : 'orders'}
            </span>
            <DeltaBadge change={change} />
          </div>
        )}
      </Status>
    </Card>
  )
}

/** The latest payments: who, how much, how long ago. */
function RecentPaymentsBlock() {
  const { client, site, query, openView } = useDashboard()
  const payments = useResource<Page<Payment>>(requestKey('recent-payments', site.id, query), () =>
    client.payments(site.id, { ...query, limit: 5 }),
  )
  const [now] = useState(() => Date.now())
  const list = payments.data?.items ?? []
  return (
    <Card
      title="Recent payments"
      actions={
        openView && (
          <button type="button" className="analytik-link" onClick={() => openView('revenue')}>
            View all
          </button>
        )
      }
    >
      <Status loading={payments.loading && !payments.data} error={payments.error}>
        {list.length ? (
          <ul className="analytik-feed-list">
            {list.map((p) => (
              <li key={p.id}>
                <Visitor
                  id={p.customerId ?? p.email ?? p.id}
                  label={p.name ?? p.email ?? p.customerId ?? <span className="analytik-muted">Anonymous</span>}
                />
                <span className="analytik-feed-meta">
                  <strong data-refund={p.kind === 'refund' ? '' : undefined}>
                    {formatMoney(p.amount, p.currency)}
                  </strong>
                  <span className="analytik-muted">{formatAgo(p.ts, now)}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="analytik-empty">No payments in this period</p>
        )}
      </Status>
    </Card>
  )
}

/** The first funnel, as bars with the visitors lost at each step shaded. */
function FunnelBlock() {
  const { client, site, query, openView } = useDashboard()
  const funnels = useResource<Funnel[]>(requestKey('funnels', site.id), () => client.funnels(site.id))
  const first = funnels.data?.[0]
  const result = useResource<FunnelResult | null>(requestKey('funnel-block', site.id, first?.id, query), () =>
    first ? client.funnel(site.id, first.id, query) : Promise.resolve(null),
  )
  const steps = result.data?.steps ?? []
  const top = Math.max(steps[0]?.visitors ?? 0, 1)
  return (
    <Card title={first ? `Funnel: ${first.name}` : 'Funnel'}>
      <Status loading={funnels.loading && !funnels.data} error={funnels.error ?? result.error}>
        {first ? (
          <ol className="analytik-funnel-bars">
            {steps.map((step, index) => (
              <li key={`${step.match}-${index}`}>
                <span className="analytik-funnel-name">{step.match}</span>
                <span className="analytik-funnel-track">
                  <motion.span
                    className="analytik-funnel-value"
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: step.visitors / top }}
                    transition={{ duration: 0.6, ease: EASE, delay: index * 0.06 }}
                  />
                </span>
                <strong>{formatNumber(step.visitors)}</strong>
              </li>
            ))}
          </ol>
        ) : (
          <div className="analytik-empty">
            <p>No funnels yet</p>
            {openView && (
              <button type="button" className="analytik-button" onClick={() => openView('funnels')}>
                Create a funnel
              </button>
            )}
          </div>
        )}
      </Status>
    </Card>
  )
}

const LIVE_REFRESH_MS = 30_000
const QUIET_LIVE_REFRESH_MS = 120_000

/** Who is on the site now and the last few things they did. */
function LiveBlock() {
  const { client, site, openView } = useDashboard()
  const live = useResource<RealtimeData>(requestKey('realtime', site.id), () => client.realtime(site.id))
  const [now, setNow] = useState(() => Date.now())
  const { reload } = live
  usePolling(
    () => {
      setNow(Date.now())
      reload()
    },
    liveSignature(live.data),
    LIVE_REFRESH_MS,
    QUIET_LIVE_REFRESH_MS,
  )
  const data = live.data
  return (
    <Card
      title="Live now"
      actions={
        openView && (
          <button type="button" className="analytik-link" onClick={() => openView('realtime')}>
            Open map
          </button>
        )
      }
    >
      <Status loading={live.loading && !data} error={live.error}>
        {data && (
          <>
            <p className="analytik-live-count">
              <span className="analytik-live-dot" data-idle={data.online ? undefined : ''} aria-hidden="true" />
              <strong className="analytik-stat-value">
                <AnimatedNumber value={data.online} format={formatNumber} />
              </strong>
              {data.online === 1 ? ' visitor' : ' visitors'} right now
            </p>
            <ul className="analytik-feed-list">
              {data.recent.slice(0, 5).map((event, index) => {
                const { who, action, target } = describeEvent(event)
                return (
                  <li key={`${event.ts}-${index}`}>
                    <span>
                      {who} {action} <strong>{target || '—'}</strong>
                    </span>
                    <span className="analytik-muted">{formatAgo(event.ts, now)}</span>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </Status>
    </Card>
  )
}

/** Every block the overview can show. The first six make up the default layout. */
export const BLOCKS = {
  summary: {
    name: 'Summary and chart',
    description: 'The headline numbers over a chart; click a number to plot it.',
    category: 'Traffic',
    wide: true,
    configurable: true,
    render: ({ editing }) => <SummaryBlock editing={editing} />,
  },
  sources: {
    name: 'Acquisition',
    description: 'Channels, referrers, campaigns and search terms.',
    category: 'Traffic',
    wide: false,
    render: () => (
      <BreakdownCard title="Acquisition" dimensions={['channel', 'referrer', 'campaign', 'term']} limit={8} />
    ),
  },
  locations: {
    name: 'Geography',
    description: 'Countries, regions and cities.',
    category: 'Audience',
    wide: false,
    render: () => <BreakdownCard title="Geography" dimensions={['country', 'region', 'city']} limit={8} />,
  },
  pages: {
    name: 'Pages',
    description: 'Top pages, where visits start and end, and outbound links.',
    category: 'Content',
    wide: false,
    render: () => <BreakdownCard title="Pages" dimensions={['page', 'entry', 'exit', 'outbound']} limit={8} />,
  },
  technology: {
    name: 'Devices',
    description: 'Browsers, operating systems and device types.',
    category: 'Audience',
    wide: false,
    render: () => <BreakdownCard title="Devices" dimensions={['browser', 'os', 'device']} limit={8} />,
  },
  goals: {
    name: 'Goals',
    description: 'Completed goals and custom events.',
    category: 'Content',
    wide: false,
    render: () => <BreakdownCard title="Goals" dimensions={['goal', 'event']} limit={8} />,
  },
  kpis: {
    name: 'Key numbers',
    description: 'Visitors, pageviews, sessions and revenue on tiles, each with its trend.',
    category: 'Traffic',
    wide: true,
    render: () => <KeyNumbersBlock />,
  },
  campaigns: {
    name: 'Campaigns',
    description: 'UTM campaigns, mediums, content and ref codes.',
    category: 'Traffic',
    wide: false,
    render: () => <BreakdownCard title="Campaigns" dimensions={['campaign', 'medium', 'content', 'ref']} limit={8} />,
  },
  channels: {
    name: 'Channel performance',
    description: 'Visitors, conversion and revenue per channel in one table.',
    category: 'Revenue',
    wide: false,
    render: () => <ChannelTableBlock />,
  },
  devices: {
    name: 'Device split',
    description: 'Desktop, mobile and tablet visitors as a ring.',
    category: 'Audience',
    wide: false,
    render: () => <DeviceSplitBlock />,
  },
  funnel: {
    name: 'Funnel',
    description: 'Your first funnel, step by step, with the drop-off shaded.',
    category: 'Content',
    wide: false,
    render: () => <FunnelBlock />,
  },
  'revenue-sources': {
    name: 'Revenue by source',
    description: 'Which channels, sources and campaigns bring paying customers.',
    category: 'Revenue',
    wide: false,
    render: () => (
      <BreakdownCard
        title="Revenue by source"
        dimensions={['channel', 'source', 'campaign']}
        metric="revenue"
        limit={8}
      />
    ),
  },
  'revenue-countries': {
    name: 'Revenue by country',
    description: 'Where paying customers are.',
    category: 'Revenue',
    wide: false,
    render: () => <BreakdownCard title="Revenue by country" dimensions={['country']} metric="revenue" limit={8} />,
  },
  'order-value': {
    name: 'Average order value',
    description: 'Revenue per order, against the previous period.',
    category: 'Revenue',
    wide: false,
    render: () => <OrderValueBlock />,
  },
  payments: {
    name: 'Recent payments',
    description: 'The latest five payments and refunds.',
    category: 'Revenue',
    wide: false,
    render: () => <RecentPaymentsBlock />,
  },
  live: {
    name: 'Live now',
    description: 'Visitors on the site right now and what they just did.',
    category: 'Live',
    wide: false,
    render: () => <LiveBlock />,
  },
} satisfies Record<string, BlockType>

export type BlockId = keyof typeof BLOCKS

export const BLOCK_IDS = Object.keys(BLOCKS) as BlockId[]
