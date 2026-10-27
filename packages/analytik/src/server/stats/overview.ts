import { MINUTE, bucketStarts } from '../../shared/time'
import type { Overview, TimeseriesPoint } from '../../shared/types'
import type { Context } from '../context'
import type { SiteRecord } from '../sites'
import { type Fragment, type StatsQuery, delta, filterSql, hasFilters, ratio, sessionWhere } from './query'

const ONLINE_WINDOW = 5 * MINUTE

interface Totals {
  visitors: number
  sessions: number
  pageviews: number
  bounces: number
  duration: number
}

interface Revenue {
  revenue: number
  orders: number
  customers: number
}

/**
 * Payments in `[from, to)` in the site's currency (with `other`, in every other currency; amounts in different
 * currencies can't be added up). With filters, only those credited to a matching visit.
 */
export function paymentsFrom(
  site: SiteRecord,
  query: StatsQuery,
  from = query.from,
  to = query.to,
  other = false,
): Fragment {
  const where = `p.site_id = ? AND p.ts >= ? AND p.ts < ? AND p.currency ${other ? '<>' : '='} ?`
  const params = [site.id, from, to, site.currency]
  if (!hasFilters(query.filters)) return { sql: `payments p WHERE ${where}`, params }
  const filters = filterSql(query.filters)
  return {
    sql: `payments p JOIN sessions s ON s.site_id = p.site_id AND s.id = p.session_id WHERE ${where}${filters.sql}`,
    params: [...params, ...filters.params],
  }
}

export const REVENUE_COLUMNS = `COALESCE(SUM(p.amount), 0) AS revenue,
  COALESCE(SUM(CASE WHEN p.kind = 'payment' THEN 1 ELSE 0 END), 0) AS orders,
  COUNT(DISTINCT CASE WHEN p.kind = 'payment' AND p.renewal = 0 THEN COALESCE(p.visitor_id, p.id) END) AS customers`

async function totals(ctx: Context, where: Fragment): Promise<Totals> {
  const [row] = (await ctx.storage.query<Totals>(
    `SELECT COUNT(DISTINCT s.visitor_id) AS visitors, COUNT(*) AS sessions, COALESCE(SUM(s.pageviews), 0) AS pageviews,
       COALESCE(SUM(CASE WHEN s.pageviews <= 1 AND s.goals = 0 THEN 1 ELSE 0 END), 0) AS bounces,
       COALESCE(SUM(s.duration), 0) AS duration
     FROM sessions s WHERE ${where.sql}`,
    where.params,
  )) as [Totals]
  return row
}

async function revenue(ctx: Context, from: Fragment): Promise<Revenue> {
  const [row] = (await ctx.storage.query<Revenue>(`SELECT ${REVENUE_COLUMNS} FROM ${from.sql}`, from.params)) as [
    Revenue,
  ]
  return row
}

function otherCurrencies(ctx: Context, site: SiteRecord, query: StatsQuery): Promise<Overview['otherCurrencies']> {
  const from = paymentsFrom(site, query, query.from, query.to, true)
  return ctx.storage.query(
    `SELECT p.currency, COALESCE(SUM(p.amount), 0) AS amount,
       COALESCE(SUM(CASE WHEN p.kind = 'payment' THEN 1 ELSE 0 END), 0) AS orders
     FROM ${from.sql} GROUP BY p.currency ORDER BY orders DESC, p.currency`,
    from.params,
  )
}

export async function online(ctx: Context, siteId: string): Promise<number> {
  const [row] = await ctx.storage.query<{ n: number }>(
    'SELECT COUNT(DISTINCT visitor_id) AS n FROM sessions WHERE site_id = ? AND last_seen_at > ?',
    [siteId, ctx.now() - ONLINE_WINDOW],
  )
  return row?.n ?? 0
}

/** Headline numbers for the range, each compared with the range of the same length just before it. */
export async function overview(ctx: Context, site: SiteRecord, query: StatsQuery): Promise<Overview> {
  const previousFrom = query.from - (query.to - query.from)
  const [current, previous, money, previousMoney, visitorsOnline, other] = await Promise.all([
    totals(ctx, sessionWhere(site.id, query)),
    totals(ctx, sessionWhere(site.id, query, previousFrom, query.from)),
    revenue(ctx, paymentsFrom(site, query)),
    revenue(ctx, paymentsFrom(site, query, previousFrom, query.from)),
    online(ctx, site.id),
    otherCurrencies(ctx, site, query),
  ])
  const pair = (pick: (totals: Totals, revenue: Revenue) => number) =>
    delta(pick(current, money), pick(previous, previousMoney))
  return {
    visitors: pair((t) => t.visitors),
    sessions: pair((t) => t.sessions),
    pageviews: pair((t) => t.pageviews),
    bounceRate: pair((t) => ratio(t.bounces, t.sessions)),
    avgDurationMs: pair((t) => Math.round(ratio(t.duration, t.sessions))),
    revenue: pair((_, r) => r.revenue),
    orders: pair((_, r) => r.orders),
    conversionRate: pair((t, r) => ratio(r.customers, t.visitors)),
    revenuePerVisitor: pair((t, r) => ratio(r.revenue, t.visitors)),
    currency: site.currency,
    online: visitorsOnline,
    otherCurrencies: other,
  }
}

/**
 * Buckets as an inline VALUES table, clipped to the range. The values are integers computed here,
 * so inlining is safe, and it keeps D1 under its bound-parameter limit for long ranges.
 */
function bucketTable(query: StatsQuery): { sql: string; starts: number[] } {
  const starts = bucketStarts(query.from, query.to, query.interval, query.tz)
  const rows = starts.map((start, index) => {
    const low = Math.max(start, query.from)
    const high = Math.min(starts[index + 1] ?? query.to, query.to)
    return `(${start}, ${low}, ${high})`
  })
  return { sql: `b (bucket, low, high) AS (VALUES ${rows.join(', ')})`, starts }
}

/** Visitors, sessions and pageviews by session start, revenue by payment time, one point per bucket. */
export async function timeseries(ctx: Context, site: SiteRecord, query: StatsQuery): Promise<TimeseriesPoint[]> {
  const buckets = bucketTable(query)
  const filters = filterSql(query.filters)
  const money = paymentsFrom(site, query)
  const [traffic, payments] = await Promise.all([
    ctx.storage.query<{ bucket: number; visitors: number; sessions: number; pageviews: number }>(
      `WITH ${buckets.sql}
       SELECT b.bucket, COUNT(DISTINCT s.visitor_id) AS visitors, COUNT(*) AS sessions,
              COALESCE(SUM(s.pageviews), 0) AS pageviews
       FROM b JOIN sessions s ON s.site_id = ? AND s.started_at >= b.low AND s.started_at < b.high${filters.sql}
       GROUP BY b.bucket`,
      [site.id, ...filters.params],
    ),
    ctx.storage.query<{ bucket: number; revenue: number }>(
      `WITH ${buckets.sql}
       SELECT b.bucket, COALESCE(SUM(p.amount), 0) AS revenue
       FROM b JOIN (SELECT p.ts, p.amount FROM ${money.sql}) p ON p.ts >= b.low AND p.ts < b.high
       GROUP BY b.bucket`,
      money.params,
    ),
  ])
  const trafficBy = new Map(traffic.map((row) => [row.bucket, row]))
  const revenueBy = new Map(payments.map((row) => [row.bucket, row.revenue]))
  return buckets.starts.map((ts) => ({
    ts,
    visitors: trafficBy.get(ts)?.visitors ?? 0,
    sessions: trafficBy.get(ts)?.sessions ?? 0,
    pageviews: trafficBy.get(ts)?.pageviews ?? 0,
    revenue: revenueBy.get(ts) ?? 0,
  }))
}
