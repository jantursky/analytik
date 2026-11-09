import { RETENTION_COHORTS, RETENTION_WEEKS } from '../../shared/retention'
import { DAY } from '../../shared/time'
import type { RetentionCohort, RetentionResult } from '../../shared/types'
import type { Context } from '../context'
import type { SiteRecord } from '../sites'
import { type StatsQuery, filterSql } from './query'

export { RETENTION_COHORTS, RETENTION_WEEKS }
const WEEK = 7 * DAY
// 1 January 1970 was a Thursday; shifting by three days makes week numbers start on Monday.
const MONDAY_SHIFT = 3 * DAY

interface Row {
  cohort: number | string
  off: number | string
  n: number | string
}

const weekOf = (ms: number): number => Math.floor((ms + MONDAY_SHIFT) / WEEK)

/**
 * One aggregate: for each weekly cohort of new visitors, how many were active in each following week. A visitor
 * belongs to the cohort of the week they were first seen, and filters apply to their first session only. Offset -1
 * carries the cohort size, so a cohort is counted even when its own week has no session (imported data).
 */
export function retentionStatement(
  siteId: string,
  query: StatsQuery,
  firstWeek: number,
  lastWeek: number,
): { sql: string; params: unknown[] } {
  const filters = filterSql(query.filters, query.dialect)
  // Week numbers are computed from constants written into the SQL, so every database types them as integers.
  const week = (column: string): string => `((${column} + ${MONDAY_SHIFT}) / ${WEEK})`
  return {
    sql: `WITH c AS (
       SELECT DISTINCT v.id AS id, ${week('v.first_seen')} AS cohort
       FROM visitors v
       JOIN sessions s ON s.site_id = v.site_id AND s.visitor_id = v.id AND s.started_at = (
         SELECT MIN(m.started_at) FROM sessions m WHERE m.site_id = v.site_id AND m.visitor_id = v.id
       )
       WHERE v.site_id = ? AND v.first_seen >= ? AND v.first_seen < ?${filters.sql}
     )
     SELECT cohort, -1 AS off, COUNT(*) AS n FROM c GROUP BY cohort
     UNION ALL
     SELECT c.cohort AS cohort, a.wk - c.cohort AS off, COUNT(*) AS n
     FROM c
     JOIN (
       SELECT DISTINCT visitor_id, ${week('started_at')} AS wk
       FROM sessions
       WHERE site_id = ? AND started_at >= ? AND started_at < ?
     ) a ON a.visitor_id = c.id
     WHERE a.wk >= c.cohort AND a.wk - c.cohort < ${RETENTION_WEEKS}
     GROUP BY c.cohort, a.wk - c.cohort`,
    params: [
      siteId,
      firstWeek * WEEK - MONDAY_SHIFT,
      Math.min(query.to, (lastWeek + 1) * WEEK - MONDAY_SHIFT),
      ...filters.params,
      siteId,
      firstWeek * WEEK - MONDAY_SHIFT,
      query.to,
    ],
  }
}

/**
 * Weekly retention over the range: at most the latest 12 cohorts, each followed for up to 12 weeks, ending with the
 * range. Needs visitors recognised across days, so only the persistent privacy mode answers; others get no cohorts.
 */
export async function retention(ctx: Context, site: SiteRecord, query: StatsQuery): Promise<RetentionResult> {
  const base = { privacyMode: site.privacyMode, from: query.from, to: query.to }
  if (site.privacyMode !== 'persistent') return { available: false, ...base, cohorts: [] }

  const lastWeek = weekOf(query.to - 1)
  const firstWeek = Math.max(weekOf(query.from), lastWeek - (RETENTION_COHORTS - 1))
  const statement = retentionStatement(site.id, query, firstWeek, lastWeek)
  const rows = await ctx.storage.query<Row>(statement.sql, statement.params)

  const cohorts = new Map<number, RetentionCohort>()
  for (let week = firstWeek; week <= lastWeek; week++) {
    // Weeks after the end of the range have not happened yet in this view, so they are not listed.
    cohorts.set(week, {
      week: week * WEEK - MONDAY_SHIFT,
      size: 0,
      active: Array.from({ length: Math.min(RETENTION_WEEKS, lastWeek - week + 1) }, () => 0),
    })
  }
  for (const row of rows) {
    const cohort = cohorts.get(Number(row.cohort))
    if (!cohort) continue
    const offset = Number(row.off)
    if (offset === -1) cohort.size = Number(row.n)
    else if (offset < cohort.active.length) cohort.active[offset] = Number(row.n)
  }
  return { available: true, ...base, cohorts: [...cohorts.values()].filter((cohort) => cohort.size > 0) }
}
