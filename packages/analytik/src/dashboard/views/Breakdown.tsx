import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'

import type { BreakdownRow, Dimension } from '../../shared/types'
import { BarList, type BarListRow } from '../charts'
import { requestKey, useDashboard } from '../context'
import { useResource } from '../data'
import { Flag } from '../flags'
import { countryName, formatMoney, formatNumber } from '../format'
import { Icon } from '../icons'
import { msg, t } from '../i18n'
import { hasLogo, Logo } from '../logo'
import { Card, Status } from '../ui'
import { Tabs } from '../ui/tabs'

export const DIMENSION_LABELS: Record<Dimension, string> = {
  channel: msg('Channel'),
  source: msg('Source'),
  referrer: msg('Referrer'),
  campaign: msg('Campaign'),
  medium: msg('Medium'),
  term: msg('Term'),
  content: msg('Content'),
  ref: msg('Ref code'),
  page: msg('Page'),
  entry: msg('Entry page'),
  exit: msg('Exit page'),
  country: msg('Country'),
  region: msg('Region'),
  city: msg('City'),
  browser: msg('Browser'),
  os: msg('OS'),
  device: msg('Device'),
  event: msg('Event'),
  outbound: msg('Outbound link'),
  goal: msg('Goal'),
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
          <Flag code={key} />
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
  const { client, site, query, addFilter, known } = useDashboard()
  const [dimension, setDimension] = useState(dimensions[0] ?? 'page')
  const [expanded, setExpanded] = useState(false)
  // The rows carry their dimension: while another tab loads, the previous tab's rows stay until they cross-fade.
  const rows = useResource(requestKey('breakdown', site.id, dimension, query), () =>
    client.breakdown(site.id, dimension, query).then((list) => ({ dimension, list })),
  )
  const format = metric === 'revenue' ? (v: number) => formatMoney(v, site.currency) : formatNumber
  const shown = rows.data
  const data = (shown?.list ?? []).filter((r: BreakdownRow) => metric !== 'revenue' || r.revenue)
  // The palette offers these values as filters without asking the server again.
  const loaded = shown?.list
  useEffect(() => {
    if (known && shown && loaded)
      known.set(
        shown.dimension,
        loaded.map((r) => r.key),
      )
  }, [known, shown, loaded])
  const heading = <span className="analytik-col-head">{metric === 'revenue' ? t('Revenue') : t('Visitors')}</span>
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
              label={
                metric === 'revenue'
                  ? t('{dimension} by revenue', { dimension: t(DIMENSION_LABELS[shown.dimension]) })
                  : t('{dimension} by visitors', { dimension: t(DIMENSION_LABELS[shown.dimension]) })
              }
              rows={data.map((r) => ({
                key: r.key,
                label: rowLabel(shown.dimension, r.key),
                value: r[metric],
                ...(r.previous && { previous: r.previous[metric] }),
              }))}
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
                {expanded ? t('Fewer') : t('Details')}
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
          tabs={dimensions.map((d) => ({ value: d, label: t(DIMENSION_LABELS[d]) }))}
          value={dimension}
          onChange={setDimension}
          extra={heading}
        >
          {list}
        </Tabs>
      ) : (
        <>
          <div className="analytik-tabs-row">
            <h3>{t(DIMENSION_LABELS[dimension])}</h3>
            {heading}
          </div>
          {list}
        </>
      )}
    </Card>
  )
}
