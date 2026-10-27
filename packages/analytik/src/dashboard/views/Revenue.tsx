import { useState } from 'react'

import type { Payment, PaymentKind, PaymentMatch } from '../../shared/types'
import { requestKey, useDashboard } from '../context'
import { formatDateTime, formatInteger, formatMoney, formatMoneyShort, formatNumber, formatPercent } from '../format'
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
  { value: 'api', label: 'API' },
]

const MATCHES: Record<PaymentMatch, string> = {
  metadata: 'Checkout metadata',
  return_page: 'Return page',
  customer: 'Known customer',
  email: 'Email',
  timing: 'Timing',
}

export function Revenue() {
  const { client, site, query } = useDashboard()
  const { overview, series } = useOverview()
  const [selected, setSelected] = useState<string | null>(null)
  const data = overview.data
  const money = (v: number): string => formatMoney(v, data?.currency ?? site.currency)
  const short = (v: number): string => formatMoneyShort(v, data?.currency ?? site.currency)
  const columns: Column<Payment>[] = [
    { key: 'date', label: 'Date', sort: 'time', render: (p) => formatDateTime(p.ts, site.timezone) },
    {
      key: 'customer',
      label: 'Customer',
      sort: 'customer',
      render: (p) => (
        <Visitor
          id={p.customerId ?? p.email ?? p.id}
          copy={
            p.customerId || p.email
              ? { text: p.customerId ?? p.email ?? '', label: p.customerId ? 'Copy customer id' : 'Copy email' }
              : undefined
          }
          filter={p.visitorId ?? undefined}
          label={
            <>
              {p.name ?? p.email ?? p.customerId ?? <span className="analytik-muted">Anonymous</span>}
              {p.name && p.email && <span className="analytik-sub">{p.email}</span>}
            </>
          }
        />
      ),
    },
    {
      key: 'amount',
      label: 'Amount',
      sort: 'amount',
      numeric: true,
      render: (p) => (
        <>
          <strong>{formatMoney(p.amount, p.currency)}</strong>
          {p.kind === 'refund' && (
            <span className="analytik-badge" data-trend="down">
              refund
            </span>
          )}
          {p.renewal && <span className="analytik-badge">renewal</span>}
        </>
      ),
    },
    {
      key: 'provider',
      label: 'Provider',
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
      label: 'Attributed by',
      sort: 'attribution',
      render: (p) =>
        p.matchedBy ? (
          <span className="analytik-badge" data-trend="up">
            {MATCHES[p.matchedBy]}
          </span>
        ) : (
          <span className="analytik-muted">Unattributed</span>
        ),
    },
  ]

  return (
    <View>
      <Status loading={overview.loading && !data} error={overview.error}>
        {data && (
          <div className="analytik-stats">
            <StatTile label="Revenue" delta={data.revenue} format={short} exact={money} />
            <StatTile label="Orders" delta={data.orders} format={formatNumber} exact={formatInteger} />
            <StatTile label="Conversion rate" delta={data.conversionRate} format={formatPercent} />
            <StatTile label="Revenue per visitor" delta={data.revenuePerVisitor} format={short} exact={money} />
          </div>
        )}
      </Status>
      <Card title="Revenue">
        <Status loading={series.loading && !series.data} error={series.error}>
          <TrafficChart points={series.data ?? []} metric="revenue" />
        </Status>
      </Card>
      <BreakdownCard
        title="Revenue by"
        dimensions={['channel', 'source', 'campaign', 'page', 'country']}
        metric="revenue"
        limit={20}
      />
      <DataTable
        title="Payments"
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
        searchLabel="Search customers, emails, order ids"
        empty="No payments in this period"
        filters={[
          {
            key: 'kind',
            label: 'Kind',
            options: [
              { value: '', label: 'Payments and refunds' },
              { value: 'payment', label: 'Payments' },
              { value: 'refund', label: 'Refunds' },
            ],
          },
          { key: 'provider', label: 'Provider', options: [{ value: '', label: 'All providers' }, ...PROVIDERS] },
          {
            key: 'attributed',
            label: 'Attribution',
            options: [
              { value: '', label: 'Any attribution' },
              { value: 'yes', label: 'Attributed' },
              { value: 'no', label: 'Unattributed' },
            ],
          },
          { key: 'visitor', label: 'Visitor', format: shortId },
        ]}
        onOpen={(p) => p.sessionId && setSelected(p.sessionId)}
        openLabel={(p) => `Open the visit behind payment ${p.id}`}
      />
      <SessionDialog sessionId={selected} onClose={() => setSelected(null)} />
    </View>
  )
}
