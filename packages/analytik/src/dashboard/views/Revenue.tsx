import { useState } from 'react'

import type { Payment, PaymentKind, PaymentMatch } from '../../shared/types'
import { requestKey, useDashboard } from '../context'
import { formatDateTime, formatInteger, formatMoney, formatMoneyShort, formatNumber, formatPercent } from '../format'
import { msg, t } from '../i18n'
import { Logo } from '../logo'
import { Card, StatTile, Status } from '../ui'
import { View } from '../ui/motion'
import { BreakdownCard } from './Breakdown'
import { Visitor } from './cells'
import { type Column, DataTable } from './DataTable'
import { SessionDialog, shortId } from './Sessions'
import { useOverview } from './useOverview'
import { TrafficChart } from './TrafficChart'

const PROVIDERS = [
  { value: 'stripe', label: 'Stripe' },
  { value: 'dodo', label: 'Dodo Payments' },
  { value: 'lemonsqueezy', label: 'Lemon Squeezy' },
  { value: 'api', label: msg('API') },
]

const MATCHES: Record<PaymentMatch, string> = {
  metadata: msg('Checkout metadata'),
  return_page: msg('Return page'),
  customer: msg('Known customer'),
  email: msg('Email'),
  timing: msg('Timing'),
}

export function Revenue() {
  const { client, site, query } = useDashboard()
  const { overview, series } = useOverview()
  const [selected, setSelected] = useState<string | null>(null)
  const data = overview.data
  const money = (v: number): string => formatMoney(v, data?.currency ?? site.currency)
  const short = (v: number): string => formatMoneyShort(v, data?.currency ?? site.currency)
  const columns: Column<Payment>[] = [
    { key: 'date', label: t('Date'), sort: 'time', render: (p) => formatDateTime(p.ts, site.timezone) },
    {
      key: 'customer',
      label: t('Customer'),
      sort: 'customer',
      render: (p) => (
        <Visitor
          id={p.customerId ?? p.email ?? p.id}
          copy={
            p.customerId || p.email
              ? { text: p.customerId ?? p.email ?? '', label: p.customerId ? t('Copy customer id') : t('Copy email') }
              : undefined
          }
          filter={p.visitorId ?? undefined}
          label={
            <>
              {p.name ?? p.email ?? p.customerId ?? <span className="analytik-muted">{t('Anonymous')}</span>}
              {p.name && p.email && <span className="analytik-sub">{p.email}</span>}
            </>
          }
        />
      ),
    },
    {
      key: 'amount',
      label: t('Amount'),
      sort: 'amount',
      numeric: true,
      render: (p) => (
        <>
          <strong>{formatMoney(p.amount, p.currency)}</strong>
          {p.kind === 'refund' && (
            <span className="analytik-badge" data-trend="down">
              {t('refund')}
            </span>
          )}
          {p.renewal && <span className="analytik-badge">{t('renewal')}</span>}
        </>
      ),
    },
    {
      key: 'provider',
      label: t('Provider'),
      sort: 'provider',
      render: (p) => {
        const label = PROVIDERS.find((known) => known.value === p.provider)?.label ?? p.provider
        return (
          <span className="analytik-tech">
            <Logo name={label} />
            {label}
          </span>
        )
      },
    },
    {
      key: 'attribution',
      label: t('Attributed by'),
      sort: 'attribution',
      render: (p) =>
        p.matchedBy ? (
          <span className="analytik-badge" data-trend="up">
            {t(MATCHES[p.matchedBy])}
          </span>
        ) : (
          <span className="analytik-muted">{t('Unattributed')}</span>
        ),
    },
  ]

  return (
    <View>
      <Status loading={overview.loading && !data} error={overview.error}>
        {data && (
          <div className="analytik-stats">
            <StatTile label={t('Revenue')} delta={data.revenue} format={short} exact={money} />
            <StatTile label={t('Orders')} delta={data.orders} format={formatNumber} exact={formatInteger} />
            <StatTile label={t('Conversion rate')} delta={data.conversionRate} format={formatPercent} />
            <StatTile label={t('Revenue per visitor')} delta={data.revenuePerVisitor} format={short} exact={money} />
          </div>
        )}
      </Status>
      <Card title={t('Revenue')}>
        <Status loading={series.loading && !series.data} error={series.error}>
          <TrafficChart points={series.data ?? []} metric="revenue" />
        </Status>
      </Card>
      <BreakdownCard
        title={t('Revenue by')}
        dimensions={['channel', 'source', 'campaign', 'page', 'country']}
        metric="revenue"
        limit={20}
      />
      <DataTable
        title={t('Payments')}
        columns={columns}
        basis={requestKey('payments', site.id)}
        load={({ filters, ...request }) =>
          client.payments(site.id, {
            ...query,
            ...request,
            kind: filters.kind as PaymentKind | undefined,
            provider: filters.provider,
            attributed: filters.attributed === undefined ? undefined : filters.attributed === 'yes',
            visitor: filters.visitor,
          })
        }
        rowKey={(p) => p.id}
        searchLabel={t('Search customers, emails, order ids')}
        empty={t('No payments in this period')}
        filters={[
          {
            key: 'kind',
            label: t('Kind'),
            options: [
              { value: '', label: t('Payments and refunds') },
              { value: 'payment', label: t('Payments') },
              { value: 'refund', label: t('Refunds') },
            ],
          },
          {
            key: 'provider',
            label: t('Provider'),
            options: [{ value: '', label: t('All providers') }, ...PROVIDERS.map((p) => ({ ...p, label: t(p.label) }))],
          },
          {
            key: 'attributed',
            label: t('Attribution'),
            options: [
              { value: '', label: t('Any attribution') },
              { value: 'yes', label: t('Attributed') },
              { value: 'no', label: t('Unattributed') },
            ],
          },
          { key: 'visitor', label: t('Visitor'), format: shortId },
        ]}
        onOpen={(p) => p.sessionId && setSelected(p.sessionId)}
        openLabel={(p) => t('Open the visit behind payment {id}', { id: p.id })}
      />
      <SessionDialog sessionId={selected} onClose={() => setSelected(null)} />
    </View>
  )
}
