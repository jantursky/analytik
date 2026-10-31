import { motion } from 'motion/react'
import { useState } from 'react'

import type { Site, SiteSummary } from '../../shared/types'
import type { ApiClient } from '../api'
import { requestKey } from '../context'
import { useResource } from '../data'
import { formatDate, formatDateTime, formatMoney, formatMoneyShort, formatNumber } from '../format'
import { msg, t } from '../i18n'
import { Icon } from '../icons'
import { usePreferences } from '../preferences'
import { Sparkline, type SparkDetail } from '../charts'
import { DeltaBadge, Shortened, SiteTile } from '../ui'
import { ActionMenu, MenuButton } from '../ui/menu'
import { rise, View } from '../ui/motion'
import { Select } from '../ui/select'
import { Tooltip } from '../ui/tooltip'
import { DeleteSiteDialog, togglePaused } from './SiteActions'

const HOUR = 3600000
const DAY = 86400000
const MINUTE = 60000

type PeriodKey = '24h' | '7d' | '30d'

/** What the cards cover; longer periods are drawn a day at a time, the shortest an hour at a time. */
interface Period {
  value: PeriodKey
  label: string
  foot: string
  days: number
  series: 'hour' | 'day'
}
const PERIODS: [Period, ...Period[]] = [
  { value: '24h', label: msg('Last 24 hours'), foot: msg('visitors in the last 24h'), days: 1, series: 'hour' },
  { value: '7d', label: msg('Last 7 days'), foot: msg('visitors in the last 7 days'), days: 7, series: 'day' },
  { value: '30d', label: msg('Last 30 days'), foot: msg('visitors in the last 30 days'), days: 30, series: 'day' },
]

/** The saved period of the sites overview; anything unknown is the last 24 hours. */
function parsePeriod(value: unknown): Period {
  return PERIODS.find((p) => p.value === value) ?? PERIODS[0]
}

/** Change against the window before; null (shown as "new") when that had no visitors to compare with. */
const visitorChange = (data: SiteSummary): number | null =>
  data.previous && data.previous.visitors > 0 ? (data.visitors - data.previous.visitors) / data.previous.visitors : null

type SortKey = 'added' | 'name' | 'domain' | 'visitors' | 'revenue' | 'orders'

const SORTS: { value: SortKey; label: string; numeric: boolean }[] = [
  { value: 'added', label: msg('Date added'), numeric: false },
  { value: 'name', label: msg('Name'), numeric: false },
  { value: 'domain', label: msg('Domain'), numeric: false },
  { value: 'visitors', label: msg('Visitors'), numeric: true },
  { value: 'revenue', label: msg('Revenue'), numeric: true },
  { value: 'orders', label: msg('Orders'), numeric: true },
]

/** The saved order of the sites overview; anything unknown falls back to the order the sites were added in. */
function parseSort(value: unknown): { by: SortKey; descending: boolean } {
  const saved = (value ?? {}) as { by?: unknown; descending?: unknown }
  const sort = SORTS.find((s) => s.value === saved.by) ?? SORTS[0]
  return {
    by: sort?.value ?? 'added',
    descending: typeof saved.descending === 'boolean' ? saved.descending : (sort?.numeric ?? false),
  }
}

const text = (a: string, b: string): number => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })

/** The sites in the chosen order; ties keep the order they were added in. */
function sortSites(sites: Site[], summaries: Map<string, SiteSummary>, by: SortKey, descending: boolean): Site[] {
  const number = (site: Site, key: 'visitors' | 'revenue' | 'orders'): number => summaries.get(site.id)?.[key] ?? 0
  const compare = (a: Site, b: Site): number => {
    switch (by) {
      case 'name':
        return text(a.name, b.name)
      case 'domain':
        return text(a.domain, b.domain)
      case 'added':
        return 0
      default:
        return number(a, by) - number(b, by)
    }
  }
  const order = new Map(sites.map((site, index) => [site.id, index]))
  const added = (a: Site, b: Site): number => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)
  return [...sites].sort((a, b) => (descending ? -1 : 1) * (compare(a, b) || added(a, b)))
}

function SiteCard({
  client,
  site,
  data,
  failed,
  foot,
  trend,
  onOpen,
  onChange,
}: {
  client: ApiClient
  site: Site
  data: SiteSummary | undefined
  failed: boolean
  /** The period's caption under the visitor number. */
  foot: string
  /** Where the sparklines start and how long each point is, to say what a point stands for. */
  trend: { from: number; step: number }
  onOpen: () => void
  onChange: () => void
}) {
  const [deleting, setDeleting] = useState(false)
  const details = (values: number[], format: (value: number) => string): SparkDetail[] =>
    values.map((value, i) => {
      const at = trend.from + i * trend.step
      return {
        when: trend.step < DAY ? formatDateTime(at, site.timezone) : formatDate(at, site.timezone),
        value: format(value),
      }
    })
  const online = data?.online ?? 0
  const visitors = failed ? '–' : data ? formatNumber(data.visitors) : '…'
  // Revenue only for sites that take payments: a provider is connected, or payments came in anyway (API, client).
  const takesPayments = Object.values(site.webhooks ?? {}).some(Boolean) || !!data?.orders
  return (
    <motion.li variants={rise} className="analytik-site-item" data-paused={site.paused ? '' : undefined}>
      <button type="button" className="analytik-card analytik-site-card" onClick={onOpen}>
        <span className="analytik-site-name">
          <SiteTile site={site} />
          <span>
            <strong>{site.name}</strong>
            <span className="analytik-muted">{site.domain}</span>
          </span>
          {site.paused && (
            <span className="analytik-badge" data-tone="paused">
              <Icon name="pause" />
              {t('Paused')}
            </span>
          )}
        </span>
        <span className="analytik-site-number">
          {visitors}
          {data?.previous && !failed && <DeltaBadge change={visitorChange(data)} />}
        </span>
        <span className="analytik-muted">{t(foot)}</span>
        {data?.traffic && <Sparkline values={data.traffic} details={details(data.traffic, formatNumber)} />}
        {takesPayments && data?.sales && data.sales.some((n) => n !== 0) && (
          <Sparkline values={data.sales} details={details(data.sales, (v) => formatMoney(v, data.currency))} />
        )}
        <span className="analytik-site-foot">
          <span className="analytik-site-online">
            <span className="analytik-live-dot" data-idle={online ? undefined : ''} aria-hidden="true" />
            {t('{count} online', { count: formatNumber(online) })}
          </span>
          {takesPayments && data && (
            <span className="analytik-site-revenue">
              <strong>
                <Shortened
                  shown={formatMoneyShort(data.revenue, data.currency)}
                  exact={formatMoney(data.revenue, data.currency)}
                >
                  {formatMoneyShort(data.revenue, data.currency)}
                </Shortened>
              </strong>
              {' · '}
              {t('{count, plural, one {# order} other {# orders}}', { count: data.orders })}
            </span>
          )}
        </span>
      </button>
      {/* Beside the card rather than in it: a button can't hold another button. */}
      <ActionMenu
        label={t('Actions for {name}', { name: site.name })}
        className="analytik-site-menu"
        actions={[
          {
            label: site.paused ? t('Resume tracking') : t('Pause tracking'),
            icon: site.paused ? 'play' : 'pause',
            tone: site.paused ? 'success' : 'warning',
            onSelect: () => void togglePaused(client, site).then(onChange, onChange),
          },
          { label: t('Delete website'), icon: 'trash', tone: 'danger', onSelect: () => setDeleting(true) },
        ]}
      />
      <DeleteSiteDialog client={client} site={site} open={deleting} onOpenChange={setDeleting} onDeleted={onChange} />
    </motion.li>
  )
}

export interface SitesOverviewProps {
  client: ApiClient
  sites: Site[]
  onOpen: (site: Site) => void
  onAdd: () => void
  /** Opens the dialog that brings another tool's history in; without it "Add website" is a plain button. */
  onImport?: () => void
  /** Called after a site was paused, resumed or deleted from its menu, to reload the list. */
  onChange?: () => void
}

/**
 * Every site on a card with its visitors, revenue and orders in the last 24 hours and who is online now, in an order
 * the admin picks. The numbers of all sites come in one request.
 */
export function SitesOverview({
  client,
  sites,
  onOpen,
  onAdd,
  onImport,
  onChange = () => undefined,
}: SitesOverviewProps) {
  const { values, update } = usePreferences()
  const period = parsePeriod(values.sitesPeriod)
  // Fixed to the minute, so the request isn't repeated on every render and opening the view again within the minute
  // is answered from the client's cache. Refresh moves it on and skips the cache once.
  const [now, setNow] = useState(() => Math.floor(Date.now() / MINUTE) * MINUTE)
  const [refreshed, setRefreshed] = useState(false)
  const to = now
  const from = to - period.days * DAY
  const summary = useResource<SiteSummary[]>(requestKey('summary', period.value, to, sites.length), () =>
    client.summary({ from, to }, { series: period.series, compare: true, fresh: refreshed }),
  )
  const refresh = (): void => {
    setRefreshed(true)
    setNow(Math.floor(Date.now() / MINUTE) * MINUTE)
    summary.reload()
  }
  const summaries = new Map((summary.data ?? []).map((row) => [row.siteId, row]))
  const { by, descending } = parseSort(values.sitesSort)
  const choose = (next: SortKey): void =>
    update({ sitesSort: { by: next, descending: SORTS.find((s) => s.value === next)?.numeric ?? false } })
  const sorted = sortSites(sites, summaries, by, descending)
  return (
    <View>
      <div className="analytik-page-head">
        <h1>{t('All sites')}</h1>
        <div className="analytik-action-right">
          <Select
            label={t('Period')}
            hideLabel
            className="analytik-pill"
            value={period.value}
            options={PERIODS.map((p) => ({ value: p.value, label: t(p.label) }))}
            onChange={(value) => update({ sitesPeriod: value })}
          />
          <Tooltip label={t('Refresh')}>
            <button
              type="button"
              className="analytik-pill-icon analytik-pill"
              aria-label={t('Refresh')}
              onClick={refresh}
            >
              <Icon name="refresh" />
            </button>
          </Tooltip>
          {sites.length > 1 && (
            <div className="analytik-sites-sort">
              <Select
                label={t('Sort sites by')}
                hideLabel
                className="analytik-pill"
                value={by}
                options={SORTS.map((s) => ({ value: s.value, label: t(s.label) }))}
                onChange={choose}
              />
              <button
                type="button"
                className="analytik-pill-icon analytik-pill"
                aria-label={descending ? t('Descending, switch to ascending') : t('Ascending, switch to descending')}
                onClick={() => update({ sitesSort: { by, descending: !descending } })}
              >
                <Icon name={descending ? 'descending' : 'ascending'} />
              </button>
            </div>
          )}
          {onImport ? (
            <MenuButton
              label={t('Add website')}
              variant="primary"
              actions={[
                { label: t('New website'), icon: 'plus', onSelect: onAdd },
                { label: t('Import from another tool'), icon: 'upload', onSelect: onImport },
              ]}
            />
          ) : (
            <button type="button" className="analytik-button" data-variant="primary" onClick={onAdd}>
              <Icon name="plus" />
              {t('Add website')}
            </button>
          )}
        </div>
      </div>
      <ul className="analytik-site-grid" aria-label={t('Sites')}>
        {sorted.map((site) => (
          <SiteCard
            key={site.id}
            client={client}
            site={site}
            data={summaries.get(site.id)}
            failed={!!summary.error}
            foot={period.foot}
            trend={{ from, step: period.series === 'hour' ? HOUR : DAY }}
            onOpen={() => onOpen(site)}
            onChange={onChange}
          />
        ))}
      </ul>
    </View>
  )
}
