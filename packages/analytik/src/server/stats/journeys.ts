import { JOURNEY_MAX_DAYS, JOURNEY_SESSION_CAP, JOURNEY_STEPS } from '../../shared/journeys'
import { DAY } from '../../shared/time'
import type { JourneyLink, JourneyNode, JourneysResult } from '../../shared/types'
import type { Context } from '../context'
import type { SiteRecord } from '../sites'
import { type StatsQuery, sessionWhere } from './query'

/** Pages shown at each step; the rest of the step is grouped as "Other". */
export const JOURNEY_NODES_PER_STEP = 8
export { JOURNEY_MAX_DAYS, JOURNEY_SESSION_CAP, JOURNEY_STEPS }
/** Distinct paths read back, most common first. */
const PATH_ROW_CAP = 2000

interface PathRow {
  p1: string | null
  p2: string | null
  p3: string | null
  p4: string | null
  more: number | string | null
  n: number | string
}

/**
 * The first pages of the newest sessions, one row per distinct path with its session count. A page opened twice in a
 * row (a reload) counts once. Only the session list is read through the filters; pageviews are read by session id.
 */
export function journeyPathsStatement(siteId: string, query: StatsQuery): { sql: string; params: unknown[] } {
  const sessions = sessionWhere(siteId, query)
  return {
    sql: `SELECT p1, p2, p3, p4, more, COUNT(*) AS n FROM (
       SELECT session_id,
              MAX(CASE WHEN rn = 1 THEN path END) AS p1,
              MAX(CASE WHEN rn = 2 THEN path END) AS p2,
              MAX(CASE WHEN rn = 3 THEN path END) AS p3,
              MAX(CASE WHEN rn = 4 THEN path END) AS p4,
              MAX(CASE WHEN rn = 5 THEN 1 ELSE 0 END) AS more
       FROM (
         SELECT session_id, path, ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY ts, id) AS rn
         FROM (
           SELECT e.session_id, e.path, e.ts, e.id,
                  LAG(e.path) OVER (PARTITION BY e.session_id ORDER BY e.ts, e.id) AS prev
           FROM events e
           WHERE e.site_id = ? AND e.type = 'pageview' AND e.path IS NOT NULL
             AND e.session_id IN (
               SELECT s.id FROM sessions s WHERE ${sessions.sql} ORDER BY s.started_at DESC LIMIT ${JOURNEY_SESSION_CAP}
             )
         ) viewed
         WHERE prev IS NULL OR path <> prev
       ) ranked
       WHERE rn <= ${JOURNEY_STEPS + 1}
       GROUP BY session_id
     ) firsts
     GROUP BY p1, p2, p3, p4, more
     ORDER BY n DESC, p1, p2, p3, p4
     LIMIT ${PATH_ROW_CAP}`,
    params: [siteId, ...sessions.params],
  }
}

/** Which pages get their own node at a step: the busiest, with ties in path order. */
function topPages(rows: { pages: string[]; n: number }[], step: number): Set<string> {
  const totals = new Map<string, number>()
  for (const { pages, n } of rows) {
    const page = pages[step]
    if (page !== undefined) totals.set(page, (totals.get(page) ?? 0) + n)
  }
  return new Set(
    [...totals]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, JOURNEY_NODES_PER_STEP)
      .map(([page]) => page),
  )
}

/**
 * How sessions move between pages over the range (at most the last 30 days): nodes per step, links between them and
 * where sessions end. One query reads the newest 5,000 matching sessions; the nodes and links are built from its rows.
 */
export async function journeys(ctx: Context, site: SiteRecord, query: StatsQuery): Promise<JourneysResult> {
  const from = Math.max(query.from, query.to - JOURNEY_MAX_DAYS * DAY)
  const statement = journeyPathsStatement(site.id, { ...query, from })
  const rows = (await ctx.storage.query<PathRow>(statement.sql, statement.params)).map((row) => ({
    pages: [row.p1, row.p2, row.p3, row.p4].filter((page): page is string => page !== null),
    more: Number(row.more) > 0,
    n: Number(row.n),
  }))

  const keep = Array.from({ length: JOURNEY_STEPS }, (_, step) => topPages(rows, step))
  const nodes = new Map<string, JourneyNode>()
  const links = new Map<string, JourneyLink>()
  const touch = (step: number, kind: JourneyNode['kind'], path: string | null, n: number): string => {
    const id = `${step}:${kind === 'page' ? path : kind === 'other' ? '*' : 'exit'}`
    const node = nodes.get(id)
    if (node) node.sessions += n
    else nodes.set(id, { id, step, kind, path, sessions: n })
    return id
  }

  let sessions = 0
  let multiPage = 0
  for (const { pages, more, n } of rows) {
    sessions += n
    if (pages.length > 1) multiPage += n
    let previous: string | null = null
    const visit = (id: string): void => {
      if (previous) {
        const key = `${previous}>${id}`
        const link = links.get(key)
        if (link) link.sessions += n
        else links.set(key, { from: previous, to: id, sessions: n })
      }
      previous = id
    }
    pages.forEach((page, index) => {
      const listed = keep[index]?.has(page)
      visit(listed ? touch(index + 1, 'page', page, n) : touch(index + 1, 'other', null, n))
    })
    // A session that ended inside the four steps ends there; one with more pages goes on past what is drawn.
    if (!more) visit(touch(pages.length + 1, 'exit', null, n))
  }

  const byStep = (a: JourneyNode, b: JourneyNode): number =>
    a.step - b.step || b.sessions - a.sessions || (a.id < b.id ? -1 : 1)
  return {
    from,
    to: query.to,
    capped: from > query.from,
    sessions,
    multiPage,
    nodes: [...nodes.values()].sort(byStep),
    links: [...links.values()].sort((a, b) => b.sessions - a.sessions || (a.from + a.to < b.from + b.to ? -1 : 1)),
  }
}
