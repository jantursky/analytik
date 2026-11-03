import type { VitalMetric, VitalValues, VitalsResult } from '../../shared/types'
import type { Context } from '../context'
import type { SiteRecord } from '../sites'
import type { StatsQuery } from './query'

/** Most recent reports read per metric, so a busy site costs a bounded scan. */
export const VITALS_ROW_CAP = 20_000
/** Pages listed, those with the most reports. */
export const VITALS_PAGE_LIMIT = 50
const METRICS: readonly VitalMetric[] = ['lcp', 'inp', 'cls']

interface Percentile {
  path: string | null
  n: number | string
  v: number | string
}

/**
 * The 75th percentile (nearest rank) of one metric, in the database: the newest `VITALS_ROW_CAP` reports of the range
 * are ranked per page, or all together when `grouped` is false, and the row at rank ceil(0.75 n) is kept.
 */
function percentiles(ctx: Context, siteId: string, query: StatsQuery, metric: VitalMetric, grouped: boolean) {
  const partition = grouped ? 'PARTITION BY path' : ''
  return ctx.storage.query<Percentile>(
    `SELECT ${grouped ? 'path' : 'NULL AS path'}, cnt AS n, v FROM (
       SELECT ${grouped ? 'path,' : ''} v,
              ROW_NUMBER() OVER (${partition} ORDER BY v) AS rn,
              COUNT(*) OVER (${partition}) AS cnt
       FROM (
         SELECT path, ${metric} AS v FROM vitals
         WHERE site_id = ? AND ts >= ? AND ts < ? AND ${metric} IS NOT NULL
         ORDER BY ts DESC LIMIT ${VITALS_ROW_CAP}
       ) capped
     ) ranked
     WHERE rn = (cnt * 3 + 3) / 4`,
    [siteId, query.from, query.to],
  )
}

/** Reports that carry any metric, per page and for the whole range. */
function counts(ctx: Context, siteId: string, query: StatsQuery) {
  return ctx.storage.query<{ path: string; n: number | string }>(
    `SELECT path, COUNT(*) AS n FROM (
       SELECT path FROM vitals WHERE site_id = ? AND ts >= ? AND ts < ? ORDER BY ts DESC LIMIT ${VITALS_ROW_CAP}
     ) capped GROUP BY path ORDER BY n DESC, path LIMIT ${VITALS_PAGE_LIMIT}`,
    [siteId, query.from, query.to],
  )
}

const empty = (): VitalValues => ({ samples: 0, lcp: null, inp: null, cls: null })

/** Rounds a stored value: milliseconds to whole numbers, layout shift to three decimals. */
const clean = (metric: VitalMetric, value: number | string): number =>
  metric === 'cls' ? Math.round(Number(value) * 1000) / 1000 : Math.round(Number(value))

/** The 75th percentile of each Core Web Vital over the range, for the whole site and its busiest pages. */
export async function vitalsResult(ctx: Context, site: SiteRecord, query: StatsQuery): Promise<VitalsResult> {
  const enabled = site.vitalsSample > 0
  const [pageRows, ...perMetric] = await Promise.all([
    counts(ctx, site.id, query),
    ...METRICS.flatMap((metric) => [
      percentiles(ctx, site.id, query, metric, true),
      percentiles(ctx, site.id, query, metric, false),
    ]),
  ])
  const pages = new Map(pageRows.map((row) => [row.path, { path: row.path, ...empty(), samples: Number(row.n) }]))
  const total = empty()
  METRICS.forEach((metric, index) => {
    const byPage = perMetric[index * 2] ?? []
    const overall = perMetric[index * 2 + 1] ?? []
    for (const row of byPage) {
      const page = pages.get(row.path ?? '')
      if (page) page[metric] = clean(metric, row.v)
    }
    const [all] = overall
    if (all) total[metric] = clean(metric, all.v)
  })
  // The page counts are capped to the busiest pages, so the total is the sum over every page read, not just these.
  const [sum] = await ctx.storage.query<{ n: number | string }>(
    `SELECT COUNT(*) AS n FROM (
       SELECT 1 FROM vitals WHERE site_id = ? AND ts >= ? AND ts < ? ORDER BY ts DESC LIMIT ${VITALS_ROW_CAP}
     ) capped`,
    [site.id, query.from, query.to],
  )
  total.samples = Number(sum?.n ?? 0)
  return { enabled, total, pages: [...pages.values()] }
}
