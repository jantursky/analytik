import { periodBounds } from '../../shared/time'
import type { TargetPeriod, TargetProgress, TargetsResult } from '../../shared/types'
import { placeholders } from '../../storage/sql/statements'
import type { Context } from '../context'
import type { SiteRecord } from '../sites'

/** Share of a period that must pass before a projection is shown; earlier it would swing wildly. */
export const PROJECTION_AFTER = 0.1

/** The count so far scaled to the whole period, rounded. Null while too little of the period has passed. */
export function project(count: number, start: number, end: number, now: number): number | null {
  const elapsed = (now - start) / (end - start)
  return elapsed < PROJECTION_AFTER ? null : Math.round(count / Math.min(1, elapsed))
}

/**
 * Progress of every target of a site. Each target counts in its own period, never the dashboard's date range, and all
 * targets with the same period share one grouped query, so a site costs at most three (week, month, quarter).
 */
export async function targetProgress(ctx: Context, site: SiteRecord): Promise<TargetsResult> {
  const now = ctx.now()
  const periods = [...new Set(site.targets.map((target) => target.period))]
  const counts = new Map<TargetPeriod, Map<string, number>>()
  await Promise.all(
    periods.map(async (period) => {
      const { start, end } = periodBounds(now, period, site.timezone)
      const goals = [...new Set(site.targets.filter((target) => target.period === period).map((target) => target.goal))]
      const rows = await ctx.storage.query<{ name: string; n: number | string }>(
        `SELECT name, COUNT(*) AS n FROM events
         WHERE site_id = ? AND type = 'goal' AND ts >= ? AND ts < ? AND name IN (${placeholders(goals.length)})
         GROUP BY name`,
        [site.id, start, end, ...goals],
      )
      counts.set(period, new Map(rows.map((row) => [row.name, Number(row.n)])))
    }),
  )
  const targets = site.targets.map((target): TargetProgress => {
    const { start, end } = periodBounds(now, target.period, site.timezone)
    const count = counts.get(target.period)?.get(target.goal) ?? 0
    return { ...target, count, start, end, projection: project(count, start, end, now) }
  })
  return { now, targets }
}
