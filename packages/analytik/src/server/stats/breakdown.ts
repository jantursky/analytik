import type { BreakdownRow, Dimension } from '../../shared/types'
import type { Context } from '../context'
import type { SiteRecord } from '../sites'
import { REVENUE_COLUMNS } from './overview'
import { EVENT_DIMENSIONS, SESSION_COLUMNS, type StatsQuery, filterSql, ratio, sessionWhere } from './query'

interface TrafficRow {
  key: string | null
  visitors: number
  sessions: number
  pageviews: number
}

interface MoneyRow {
  key: string | null
  revenue: number
  orders: number
  customers: number
}

const ORDER = 'ORDER BY visitors DESC, sessions DESC, key'

function merge(traffic: TrafficRow[], money: MoneyRow[], limit: number): BreakdownRow[] {
  const moneyBy = new Map(money.map((row) => [row.key ?? '', row]))
  const rows: BreakdownRow[] = traffic.map((row) => {
    const paid = moneyBy.get(row.key ?? '')
    return {
      key: row.key ?? '',
      visitors: row.visitors,
      sessions: row.sessions,
      pageviews: row.pageviews,
      revenue: paid?.revenue ?? 0,
      orders: paid?.orders ?? 0,
      conversionRate: ratio(paid?.customers ?? 0, row.visitors),
    }
  })
  // Keys that earned money in the range but had no visits in it (paid later) still show up.
  const seen = new Set(rows.map((row) => row.key))
  for (const row of money) {
    const key = row.key ?? ''
    if (seen.has(key) || rows.length >= limit) continue
    rows.push({
      key,
      visitors: 0,
      sessions: 0,
      pageviews: 0,
      revenue: row.revenue,
      orders: row.orders,
      conversionRate: 0,
    })
  }
  return rows
}

/** Session attributes: traffic by session start, revenue (site currency) from payments credited to those sessions. */
async function bySession(ctx: Context, site: SiteRecord, column: string, query: StatsQuery, limit: number) {
  const where = sessionWhere(site.id, query)
  const filters = filterSql(query.filters)
  const [traffic, money] = await Promise.all([
    ctx.storage.query<TrafficRow>(
      `SELECT s.${column} AS key, COUNT(DISTINCT s.visitor_id) AS visitors, COUNT(*) AS sessions,
         COALESCE(SUM(s.pageviews), 0) AS pageviews
       FROM sessions s WHERE ${where.sql} GROUP BY s.${column} ${ORDER} LIMIT ${limit}`,
      where.params,
    ),
    ctx.storage.query<MoneyRow>(
      `SELECT s.${column} AS key, ${REVENUE_COLUMNS}
       FROM payments p JOIN sessions s ON s.site_id = p.site_id AND s.id = p.session_id
       WHERE p.site_id = ? AND p.ts >= ? AND p.ts < ? AND p.currency = ?${filters.sql}
       GROUP BY s.${column}`,
      [site.id, query.from, query.to, site.currency, ...filters.params],
    ),
  ])
  return merge(traffic, money, limit)
}

/** Pages, goals and outbound links: traffic from events, revenue from visitors who had a matching event. */
async function byEvent(ctx: Context, site: SiteRecord, dimension: Dimension, query: StatsQuery, limit: number) {
  const { type, column } = EVENT_DIMENSIONS[dimension] as { type: string; column: string }
  const filters = filterSql(query.filters)
  const base = `FROM events e JOIN sessions s ON s.site_id = e.site_id AND s.id = e.session_id
    WHERE e.site_id = ? AND e.type = ? AND e.ts >= ? AND e.ts < ?${filters.sql}`
  const params = [site.id, type, query.from, query.to, ...filters.params]
  const [traffic, money] = await Promise.all([
    ctx.storage.query<TrafficRow>(
      `SELECT e.${column} AS key, COUNT(DISTINCT e.visitor_id) AS visitors, COUNT(DISTINCT e.session_id) AS sessions,
         COUNT(*) AS pageviews
       ${base} GROUP BY e.${column} ${ORDER} LIMIT ${limit}`,
      params,
    ),
    ctx.storage.query<MoneyRow>(
      `SELECT v.key, ${REVENUE_COLUMNS}
       FROM (SELECT DISTINCT e.${column} AS key, e.visitor_id ${base}) v
       JOIN payments p ON p.site_id = ? AND p.visitor_id = v.visitor_id AND p.ts >= ? AND p.ts < ? AND p.currency = ?
       GROUP BY v.key`,
      [...params, site.id, query.from, query.to, site.currency],
    ),
  ])
  return merge(traffic, money, limit)
}

/**
 * Top values of a dimension. For pages, goals and outbound links `pageviews` counts the events
 * themselves; `conversionRate` is paying visitors over visitors.
 */
export function breakdown(
  ctx: Context,
  site: SiteRecord,
  dimension: Dimension,
  query: StatsQuery,
  limit: number,
): Promise<BreakdownRow[]> {
  const column = SESSION_COLUMNS[dimension]
  return column ? bySession(ctx, site, column, query, limit) : byEvent(ctx, site, dimension, query, limit)
}
