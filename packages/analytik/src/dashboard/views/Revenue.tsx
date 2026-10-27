import type { Payment } from '../../shared/types'
import { requestKey, useDashboard } from '../context'
import { usePaged } from '../data'
import { formatDateTime, formatMoney, formatNumber, formatPercent } from '../format'
import { Card, StatTile, Status } from '../ui'
import { View } from '../ui/motion'
import { BreakdownCard } from './Breakdown'
import { LoadMore } from './LoadMore'
import { useOverview } from './Overview'
import { TrafficChart } from './TrafficChart'

export function Revenue() {
  const { client, site, query } = useDashboard()
  const { overview, series } = useOverview()
  const payments = usePaged<Payment>(requestKey('payments', site.id, query), (cursor) =>
    client.payments(site.id, { ...query, cursor }),
  )
  const data = overview.data
  const money = (v: number): string => formatMoney(v, data?.currency ?? site.currency)

  return (
    <View>
      <Status loading={overview.loading && !data} error={overview.error}>
        {data && (
          <div className="analytik-stats">
            <StatTile label="Revenue" delta={data.revenue} format={money} />
            <StatTile label="Orders" delta={data.orders} format={formatNumber} />
            <StatTile label="Conversion rate" delta={data.conversionRate} format={formatPercent} />
            <StatTile label="Revenue per visitor" delta={data.revenuePerVisitor} format={money} />
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
      <Card title="Payments">
        <Status loading={payments.loading} error={payments.error}>
          {payments.items.length ? (
            <div className="analytik-table-wrap">
              <table className="analytik-table">
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col" className="analytik-num">
                      Amount
                    </th>
                    <th scope="col">Provider</th>
                    <th scope="col">Customer</th>
                    <th scope="col">Attributed by</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.items.map((p) => (
                    <tr key={p.id}>
                      <td>{formatDateTime(p.ts, site.timezone)}</td>
                      <td className="analytik-num">
                        {formatMoney(p.amount, p.currency)}
                        {p.kind === 'refund' && <span className="analytik-badge">refund</span>}
                        {p.renewal && <span className="analytik-badge">renewal</span>}
                      </td>
                      <td>{p.provider}</td>
                      <td>{p.name ?? p.customerId ?? '—'}</td>
                      <td>{p.matchedBy ?? 'unattributed'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="analytik-empty">No payments in this period</p>
          )}
          <LoadMore list={payments} />
        </Status>
      </Card>
    </View>
  )
}
