import { useState } from 'react'

import type { BreakdownRow, Dimension } from '../../shared/types'
import { BarList, type BarListRow } from '../charts'
import { requestKey, useDashboard } from '../context'
import { useResource } from '../data'
import { countryName, flagEmoji, formatMoney, formatNumber } from '../format'
import { Card, Status } from '../ui'
import { Tabs } from '../ui/tabs'

export const DIMENSION_LABELS: Record<Dimension, string> = {
  channel: 'Channel',
  source: 'Source',
  referrer: 'Referrer',
  campaign: 'Campaign',
  medium: 'Medium',
  term: 'Keyword',
  content: 'Content',
  ref: 'Ref',
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
  outbound: 'Exit link',
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

/** A row label: countries get their flag and English name; the key stays the filter value. */
function rowLabel(dimension: Dimension, key: string): BarListRow['label'] {
  if (dimension !== 'country' || !key) return undefined
  return (
    <>
      <span className="analytik-bar-icon" aria-hidden="true">
        {flagEmoji(key)}
      </span>
      {countryName(key)}
    </>
  )
}

/** A card with one tab per dimension; clicking a row filters the dashboard by it. */
export function BreakdownCard({ title, dimensions, metric = 'visitors', limit = 10 }: BreakdownCardProps) {
  const { client, site, query, addFilter } = useDashboard()
  const [dimension, setDimension] = useState(dimensions[0] ?? 'page')
  const [expanded, setExpanded] = useState(false)
  const rows = useResource(requestKey('breakdown', site.id, dimension, query), () =>
    client.breakdown(site.id, dimension, query),
  )
  const format = metric === 'revenue' ? (v: number) => formatMoney(v, site.currency) : formatNumber
  const data = (rows.data ?? []).filter((r: BreakdownRow) => metric !== 'revenue' || r.revenue)
  const heading = <span className="analytik-col-head">{metric === 'revenue' ? 'Revenue' : 'Visitors'}</span>
  const list = (
    <Status loading={rows.loading && !rows.data} error={rows.error}>
      <BarList
        label={`${DIMENSION_LABELS[dimension]} by ${metric}`}
        rows={data.map((r) => ({ key: r.key, label: rowLabel(dimension, r.key), value: r[metric] }))}
        formatValue={format}
        onSelect={(key) => addFilter(dimension, key)}
        limit={expanded ? EXPANDED_LIMIT : limit}
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
