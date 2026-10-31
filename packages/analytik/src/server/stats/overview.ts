import { MINUTE, bucketStarts } from '../../shared/time'
import type { Overview, SiteSummary, TimeseriesPoint } from '../../shared/types'
import type { Context } from '../context'
import type { SiteRecord } from '../sites'
import {
  type Fragment,
  type StatsQuery,
  comparisonWindow,
  delta,
  filterSql,
  hasFilters,
  ratio,
  sessionWhere,
} from './query'

const ONLINE_WINDOW = 5 * MINUTE

interface Totals {
  visitors: number
  sessions: number
  pageviews: number
  bounces: number
  duration: number
  /** Sessions whose duration is known; imported visits without one are left out of the average. */
  timed: number
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

/** 1 for a visit whose duration is known; imports from tools that don't record it store 0, which means unknown. */
const TIMED = 'CASE WHEN s.imported IS NOT NULL AND s.duration = 0 THEN 0 ELSE 1 END'

async function totals(ctx: Context, where: Fragment): Promise<Totals> {
  const [row] = (await ctx.storage.query<Totals>(
    `SELECT COUNT(DISTINCT s.visitor_id) AS visitors, COUNT(*) AS sessions, COALESCE(SUM(s.pageviews), 0) AS pageviews,
       COALESCE(SUM(CASE WHEN s.goals > 0 OR s.pageviews > 1 THEN 0 ELSE 1 END), 0) AS bounces,
       COALESCE(SUM(s.duration), 0) AS duration,
       COALESCE(SUM(${TIMED}), 0) AS timed
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

export interface SummaryOptions {
  /** Bucket length in milliseconds: adds `traffic` and `sales` series with one point per bucket from `from`. */
  bucket?: number
  /** Adds the previous window of equal length as `previous`. */
  compare?: boolean
}

/**
 * Visitors, revenue and orders in `[from, to)` and who is online, for every site in a few grouped queries per chunk
 * of sites, rather than an overview per site: the sites overview loads in one request. With `bucket` each site also
 * gets a visitors and a revenue series, and with `compare` the totals of the window before.
 */
export async function siteSummaries(
  ctx: Context,
  sites: SiteRecord[],
  from: number,
  to: number,
  options: SummaryOptions = {},
): Promise<SiteSummary[]> {
  const { bucket, compare } = options
  // Whole numbers from the server, so they go into the SQL as literals (Postgres can't type a bare `$1 / $2`).
  const size = bucket ? Math.max(1, Math.floor(bucket)) : 0
  const points = size ? Math.max(1, Math.ceil((to - from) / size)) : 0
  const fromLiteral = Math.floor(from)
  const visitors = new Map<string, number>()
  const online = new Map<string, number>()
  const money = new Map<string, { revenue: number; orders: number }>()
  const traffic = new Map<string, number[]>()
  const sales = new Map<string, number[]>()
  const series = (map: Map<string, number[]>, siteId: string, index: number, value: number): void => {
    let list = map.get(siteId)
    if (!list) map.set(siteId, (list = Array<number>(points).fill(0)))
    if (index >= 0 && index < points) list[index] = value
  }
  for (let start = 0; start < sites.length; start += SUMMARY_CHUNK) {
    const ids = sites.slice(start, start + SUMMARY_CHUNK).map((site) => site.id)
    const list = ids.map(() => '?').join(', ')
    const [totals, here, paid, byBucket, paidByBucket] = await Promise.all([
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
      size
        ? ctx.storage.query<{ site_id: string; b: number | string; n: number | string }>(
            `SELECT site_id, (started_at - ${fromLiteral}) / ${size} AS b, COUNT(DISTINCT visitor_id) AS n FROM sessions
             WHERE site_id IN (${list}) AND started_at >= ? AND started_at < ? GROUP BY site_id, b`,
            [...ids, from, to],
          )
        : [],
      size
        ? ctx.storage.query<{ site_id: string; b: number | string; revenue: number | string }>(
            `SELECT p.site_id, (p.ts - ${fromLiteral}) / ${size} AS b, COALESCE(SUM(p.amount), 0) AS revenue
             FROM payments p JOIN sites x ON x.id = p.site_id AND x.currency = p.currency
             WHERE p.site_id IN (${list}) AND p.ts >= ? AND p.ts < ? GROUP BY p.site_id, b`,
            [...ids, from, to],
          )
        : [],
    ])
    for (const row of totals) visitors.set(row.site_id, Number(row.n))
    for (const row of here) online.set(row.site_id, Number(row.n))
    for (const row of paid) money.set(row.site_id, { revenue: Number(row.revenue), orders: Number(row.orders) })
    for (const id of ids) {
      if (size) {
        series(traffic, id, -1, 0)
        series(sales, id, -1, 0)
      }
    }
    for (const row of byBucket) series(traffic, row.site_id, Number(row.b), Number(row.n))
    for (const row of paidByBucket) series(sales, row.site_id, Number(row.b), Number(row.revenue))
  }
  const before = compare
    ? new Map((await siteSummaries(ctx, sites, from - (to - from), from)).map((s) => [s.siteId, s]))
    : null
  return sites.map((site) => {
    const previous = before?.get(site.id)
    return {
      siteId: site.id,
      visitors: visitors.get(site.id) ?? 0,
      revenue: money.get(site.id)?.revenue ?? 0,
      orders: money.get(site.id)?.orders ?? 0,
      currency: site.currency,
      online: online.get(site.id) ?? 0,
      ...(size && { traffic: traffic.get(site.id), sales: sales.get(site.id) }),
      ...(previous && {
        previous: { visitors: previous.visitors, revenue: previous.revenue, orders: previous.orders },
      }),
    }
  })
}

/**
 * Headline numbers for the range, each compared with the range of the same length just before it, or with the same
 * dates a year earlier when `compare` is `year`.
 */
export async function overview(ctx: Context, site: SiteRecord, query: StatsQuery): Promise<Overview> {
  const { from: previousFrom, to: previousTo } = comparisonWindow(query, query.compare ?? 'previous')
  const [current, previous, money, previousMoney, visitorsOnline, other] = await Promise.all([
    totals(ctx, sessionWhere(site.id, query)),
    totals(ctx, sessionWhere(site.id, query, previousFrom, previousTo)),
    revenue(ctx, paymentsFrom(site, query)),
    revenue(ctx, paymentsFrom(site, query, previousFrom, previousTo)),
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
    avgDurationMs: pair((t) => Math.round(ratio(t.duration, t.timed))),
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
  /** Sessions whose duration is known; imported visits without one are left out of the average. */
  timed: number
}

/**
 * One point per bucket: the traffic numbers by session start, the money by payment time, and the rates the overview
 * shows (bounce rate, visit duration, conversion rate, revenue per visitor) worked out per bucket the same way.
 */
export async function timeseries(ctx: Context, site: SiteRecord, query: StatsQuery): Promise<TimeseriesPoint[]> {
  const { compare, ...own } = query
  const points = await series(ctx, site, own)
  if (!compare) return points
  // The same query over the comparison window, matched bucket by bucket by position, so a leap day or a clock
  // change can't pull the line out of step. The window is as long as the range, so it has the same interval.
  const earlier = await series(ctx, site, { ...own, ...comparisonWindow(own, compare) })
  return points.map((point, index) => {
    const before = earlier[index]
    return before ? { ...point, previous: before } : point
  })
}

async function series(ctx: Context, site: SiteRecord, query: StatsQuery): Promise<TimeseriesPoint[]> {
  const buckets = bucketTable(query)
  const filters = filterSql(query.filters)
  const money = paymentsFrom(site, query)
  const [traffic, payments] = await Promise.all([
    ctx.storage.query<TrafficRow>(
      `WITH ${buckets.sql}
       SELECT b.bucket, COUNT(DISTINCT s.visitor_id) AS visitors, COUNT(*) AS sessions,
              COALESCE(SUM(s.pageviews), 0) AS pageviews,
              COALESCE(SUM(CASE WHEN s.goals > 0 OR s.pageviews > 1 THEN 0 ELSE 1 END), 0) AS bounces,
              COALESCE(SUM(s.duration), 0) AS duration,
              COALESCE(SUM(${TIMED}), 0) AS timed
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
      avgDurationMs: Math.round(ratio(t?.duration ?? 0, t?.timed ?? 0)),
      conversionRate: ratio(m?.customers ?? 0, visitors),
      revenuePerVisitor: ratio(revenue, visitors),
    }
  })
}
