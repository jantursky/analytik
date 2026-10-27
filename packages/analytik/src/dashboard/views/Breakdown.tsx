import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'

import type { BreakdownRow, Dimension } from '../../shared/types'
import { BarList, type BarListRow } from '../charts'
import { requestKey, useDashboard } from '../context'
import { useResource } from '../data'
import { countryName, flagEmoji, formatMoney, formatNumber } from '../format'
import { Icon } from '../icons'
import { hasLogo, Logo } from '../logo'
import { Card, Status } from '../ui'
import { Tabs } from '../ui/tabs'

export const DIMENSION_LABELS: Record<Dimension, string> = {
  channel: 'Channel',
  source: 'Source',
  referrer: 'Referrer',
  campaign: 'Campaign',
  medium: 'Medium',
  term: 'Term',
  content: 'Content',
  ref: 'Ref code',
  page: 'Page',
  entry: 'Entry page',
  exit: 'Exit page',
  country: 'Country',
  region: 'Region',
  city: 'City',
  browser: 'Browser',
  os: 'OS',
  device: 'Device',
  event: 'Event',
  outbound: 'Outbound link',
  goal: 'Goal',
}

export type BreakdownMetric = 'visitors' | 'revenue'

export interface BreakdownCardProps {
  title: string
  dimensions: readonly Dimension[]
  /** Default `visitors`. */
  metric?: BreakdownMetric
  /** Rows shown before "Details" expands the list. Default 10. */
  limit?: number
}

const EXPANDED_LIMIT = 100

const DEVICE_ICONS = { Desktop: 'desktop', Mobile: 'mobile', Tablet: 'tablet' } as const

/** A row label: countries get their flag and English name, browsers and systems their mark, devices an icon. */
function rowLabel(dimension: Dimension, key: string): BarListRow['label'] {
  if (dimension === 'country' && key) {
    return (
      <>
        <span className="analytik-bar-icon" aria-hidden="true">
          {flagEmoji(key)}
        </span>
        {countryName(key)}
      </>
    )
  }
  if (!key || (dimension !== 'browser' && dimension !== 'os' && dimension !== 'device')) return undefined
  let icon
  if (dimension !== 'device' && hasLogo(key)) icon = <Logo name={key} />
  if (dimension === 'device' && key in DEVICE_ICONS)
    icon = <Icon name={DEVICE_ICONS[key as keyof typeof DEVICE_ICONS]} />
  // Rows without a mark keep an empty slot, so every name in the list starts at the same place.
  return (
    <>
      <span className="analytik-bar-icon" aria-hidden="true">
        {icon}
      </span>
      {key}
    </>
  )
}

/** A card with one tab per dimension; clicking a row filters the dashboard by it. */
export function BreakdownCard({ title, dimensions, metric = 'visitors', limit = 10 }: BreakdownCardProps) {
  const { client, site, query, addFilter } = useDashboard()
  const [dimension, setDimension] = useState(dimensions[0] ?? 'page')
  const [expanded, setExpanded] = useState(false)
  // The rows carry their dimension: while another tab loads, the previous tab's rows stay until they cross-fade.
  const rows = useResource(requestKey('breakdown', site.id, dimension, query), () =>
    client.breakdown(site.id, dimension, query).then((list) => ({ dimension, list })),
  )
  const format = metric === 'revenue' ? (v: number) => formatMoney(v, site.currency) : formatNumber
  const shown = rows.data
  const data = (shown?.list ?? []).filter((r: BreakdownRow) => metric !== 'revenue' || r.revenue)
  const heading = <span className="analytik-col-head">{metric === 'revenue' ? 'Revenue' : 'Visitors'}</span>
  const list = (
    <Status loading={!shown} error={rows.error}>
      <AnimatePresence mode="wait" initial={false}>
        {shown && (
          <motion.div
            key={shown.dimension}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
          >
            <BarList
              label={`${DIMENSION_LABELS[shown.dimension]} by ${metric}`}
              rows={data.map((r) => ({ key: r.key, label: rowLabel(shown.dimension, r.key), value: r[metric] }))}
              formatValue={format}
              onSelect={(key) => addFilter(shown.dimension, key)}
              limit={expanded ? EXPANDED_LIMIT : limit}
              metric={metric}
            />
            {data.length > limit && (
              <button
                type="button"
                className="analytik-details"
                aria-expanded={expanded}
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? 'Fewer' : 'Details'}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </Status>
  )
  return (
    <Card title={title} hideTitle>
      {dimensions.length > 1 ? (
        <Tabs
          label={title}
          tabs={dimensions.map((d) => ({ value: d, label: DIMENSION_LABELS[d] }))}
          value={dimension}
          onChange={setDimension}
          extra={heading}
        >
          {list}
        </Tabs>
      ) : (
        <>
          <div className="analytik-tabs-row">
            <h3>{DIMENSION_LABELS[dimension]}</h3>
            {heading}
          </div>
          {list}
        </>
      )}
    </Card>
  )
}
