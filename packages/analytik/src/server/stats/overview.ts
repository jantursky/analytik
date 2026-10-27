import { MINUTE, bucketStarts } from '../../shared/time'
import type { Overview, SiteSummary, TimeseriesPoint } from '../../shared/types'
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
       COALESCE(SUM(CASE WHEN s.goals > 0 OR s.pageviews > 1 THEN 0 ELSE 1 END), 0) AS bounces,
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

// Sites per query: D1 binds at most 100 parameters.
const SUMMARY_CHUNK = 50

/**
 * Visitors, revenue and orders in `[from, to)` and who is online, for every site in three grouped queries per chunk
 * of sites, rather than an overview per site: the sites overview loads in one request.
 */
export async function siteSummaries(
  ctx: Context,
  sites: SiteRecord[],
  from: number,
  to: number,
): Promise<SiteSummary[]> {
  const visitors = new Map<string, number>()
  const online = new Map<string, number>()
  const money = new Map<string, { revenue: number; orders: number }>()
  for (let start = 0; start < sites.length; start += SUMMARY_CHUNK) {
    const ids = sites.slice(start, start + SUMMARY_CHUNK).map((site) => site.id)
    const list = ids.map(() => '?').join(', ')
    const [traffic, here, paid] = await Promise.all([
      ctx.storage.query<{ site_id: string; n: number | string }>(
        `SELECT site_id, COUNT(DISTINCT visitor_id) AS n FROM sessions
         WHERE site_id IN (${list}) AND started_at >= ? AND started_at < ? GROUP BY site_id`,
        [...ids, from, to],
      ),
      ctx.storage.query<{ site_id: string; n: number | string }>(
        `SELECT site_id, COUNT(DISTINCT visitor_id) AS n FROM sessions
         WHERE site_id IN (${list}) AND last_seen_at > ? GROUP BY site_id`,
        [...ids, ctx.now() - ONLINE_WINDOW],
      ),
      ctx.storage.query<{ site_id: string; revenue: number | string; orders: number | string }>(
        `SELECT p.site_id, COALESCE(SUM(p.amount), 0) AS revenue,
           COALESCE(SUM(CASE WHEN p.kind = 'payment' THEN 1 ELSE 0 END), 0) AS orders
         FROM payments p JOIN sites x ON x.id = p.site_id AND x.currency = p.currency
         WHERE p.site_id IN (${list}) AND p.ts >= ? AND p.ts < ? GROUP BY p.site_id`,
        [...ids, from, to],
      ),
    ])
    for (const row of traffic) visitors.set(row.site_id, Number(row.n))
    for (const row of here) online.set(row.site_id, Number(row.n))
    for (const row of paid) money.set(row.site_id, { revenue: Number(row.revenue), orders: Number(row.orders) })
  }
  return sites.map((site) => ({
    siteId: site.id,
    visitors: visitors.get(site.id) ?? 0,
    revenue: money.get(site.id)?.revenue ?? 0,
    orders: money.get(site.id)?.orders ?? 0,
    currency: site.currency,
    online: online.get(site.id) ?? 0,
  }))
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

interface TrafficRow {
  bucket: number
  visitors: number
  sessions: number
  pageviews: number
  bounces: number
  duration: number
}

/**
 * One point per bucket: the traffic numbers by session start, the money by payment time, and the rates the overview
 * shows (bounce rate, visit duration, conversion rate, revenue per visitor) worked out per bucket the same way.
 */
export async function timeseries(ctx: Context, site: SiteRecord, query: StatsQuery): Promise<TimeseriesPoint[]> {
  const buckets = bucketTable(query)
  const filters = filterSql(query.filters)
  const money = paymentsFrom(site, query)
  const [traffic, payments] = await Promise.all([
    ctx.storage.query<TrafficRow>(
      `WITH ${buckets.sql}
       SELECT b.bucket, COUNT(DISTINCT s.visitor_id) AS visitors, COUNT(*) AS sessions,
              COALESCE(SUM(s.pageviews), 0) AS pageviews,
              COALESCE(SUM(CASE WHEN s.goals > 0 OR s.pageviews > 1 THEN 0 ELSE 1 END), 0) AS bounces,
              COALESCE(SUM(s.duration), 0) AS duration
       FROM b JOIN sessions s ON s.site_id = ? AND s.started_at >= b.low AND s.started_at < b.high${filters.sql}
       GROUP BY b.bucket`,
      [site.id, ...filters.params],
    ),
    ctx.storage.query<Revenue & { bucket: number }>(
      `WITH ${buckets.sql}
       SELECT b.bucket, ${REVENUE_COLUMNS}
       FROM b JOIN (SELECT p.ts, p.amount, p.kind, p.renewal, p.visitor_id, p.id FROM ${money.sql}) p
         ON p.ts >= b.low AND p.ts < b.high
       GROUP BY b.bucket`,
      money.params,
    ),
  ])
  const trafficBy = new Map(traffic.map((row) => [row.bucket, row]))
  const moneyBy = new Map(payments.map((row) => [row.bucket, row]))
  return buckets.starts.map((ts) => {
    const t = trafficBy.get(ts)
    const m = moneyBy.get(ts)
    const visitors = t?.visitors ?? 0
    const sessions = t?.sessions ?? 0
    const revenue = m?.revenue ?? 0
    return {
      ts,
      visitors,
      sessions,
      pageviews: t?.pageviews ?? 0,
      revenue,
      orders: m?.orders ?? 0,
      bounceRate: ratio(t?.bounces ?? 0, sessions),
      avgDurationMs: Math.round(ratio(t?.duration ?? 0, sessions)),
      conversionRate: ratio(m?.customers ?? 0, visitors),
      revenuePerVisitor: ratio(revenue, visitors),
    }
  })
}
