import { randomId } from '../../shared/ids'
import type { Funnel, FunnelResult, FunnelStep } from '../../shared/types'
import { AnalytikError, type Context } from '../context'
import type { SiteRecord } from '../sites'
import { type StatsQuery, filterSql, prefixMatch } from './query'

interface FunnelRow {
  id: string
  name: string
  steps: string
}

const toFunnel = (row: FunnelRow): Funnel => ({
  id: row.id,
  name: row.name,
  steps: JSON.parse(row.steps) as FunnelStep[],
})

export function validateFunnel(input: unknown): { name: string; steps: FunnelStep[] } {
  const body = (input ?? {}) as { name?: unknown; steps?: unknown }
  if (typeof body.name !== 'string' || !body.name.trim()) throw new AnalytikError('name is required')
  if (!Array.isArray(body.steps) || body.steps.length < 2 || body.steps.length > 10) {
    throw new AnalytikError('steps must list 2 to 10 steps')
  }
  const steps = body.steps.map((step: unknown): FunnelStep => {
    const { type, match } = (step ?? {}) as { type?: unknown; match?: unknown }
    if ((type !== 'page' && type !== 'goal') || typeof match !== 'string' || !match || match.length > 500) {
      throw new AnalytikError('each step needs type "page" or "goal" and a match')
    }
    return { type, match }
  })
  return { name: body.name.trim().slice(0, 100), steps }
}

export async function listFunnels(ctx: Context, siteId: string): Promise<Funnel[]> {
  const rows = await ctx.storage.query<FunnelRow>('SELECT * FROM funnels WHERE site_id = ? ORDER BY created_at, id', [
    siteId,
  ])
  return rows.map(toFunnel)
}

export async function getFunnel(ctx: Context, siteId: string, id: string): Promise<Funnel | null> {
  const [row] = await ctx.storage.query<FunnelRow>('SELECT * FROM funnels WHERE site_id = ? AND id = ?', [siteId, id])
  return row ? toFunnel(row) : null
}

export async function createFunnel(ctx: Context, siteId: string, input: unknown): Promise<Funnel> {
  const { name, steps } = validateFunnel(input)
  const funnel = { id: randomId(12, ctx.random), name, steps }
  await ctx.storage.run('INSERT INTO funnels (id, site_id, name, steps, created_at) VALUES (?, ?, ?, ?, ?)', [
    funnel.id,
    siteId,
    name,
    JSON.stringify(steps),
    ctx.now(),
  ])
  return funnel
}

export async function deleteFunnel(ctx: Context, siteId: string, id: string): Promise<boolean> {
  const { changes } = await ctx.storage.run('DELETE FROM funnels WHERE site_id = ? AND id = ?', [siteId, id])
  return changes > 0
}

function stepMatcher(step: FunnelStep): (event: { type: string; name: string | null; path: string | null }) => boolean {
  if (step.type === 'goal') return (event) => event.type === 'goal' && event.name === step.match
  if (step.match.endsWith('*')) {
    const prefix = step.match.slice(0, -1)
    return (event) => event.type === 'pageview' && (event.path ?? '').startsWith(prefix)
  }
  return (event) => event.type === 'pageview' && event.path === step.match
}

/** Visitors who completed the steps in order within the range, and how many dropped off at each step. */
export async function funnelResult(
  ctx: Context,
  site: SiteRecord,
  funnel: Funnel,
  query: StatsQuery,
): Promise<FunnelResult> {
  const conditions: string[] = []
  const params: unknown[] = []
  for (const step of funnel.steps) {
    if (step.type === 'goal') {
      conditions.push(`(e.type = 'goal' AND e.name = ?)`)
      params.push(step.match)
    } else if (step.match.endsWith('*')) {
      const prefix = prefixMatch('e.path', step.match.slice(0, -1))
      conditions.push(`(e.type = 'pageview' AND ${prefix.sql})`)
      params.push(...prefix.params)
    } else {
      conditions.push(`(e.type = 'pageview' AND e.path = ?)`)
      params.push(step.match)
    }
  }
  const filters = filterSql(query.filters)
  const rows = await ctx.storage.query<{ visitor_id: string; type: string; name: string | null; path: string | null }>(
    `SELECT e.visitor_id, e.type, e.name, e.path FROM events e
     JOIN sessions s ON s.site_id = e.site_id AND s.id = e.session_id
     WHERE e.site_id = ? AND e.ts >= ? AND e.ts < ? AND (${conditions.join(' OR ')})${filters.sql}
     ORDER BY e.ts, e.id LIMIT 200000`,
    [site.id, query.from, query.to, ...params, ...filters.params],
  )
  const matchers = funnel.steps.map(stepMatcher)
  const reached = new Map<string, number>()
  for (const row of rows) {
    const at = reached.get(row.visitor_id) ?? 0
    if (matchers[at]?.(row)) reached.set(row.visitor_id, at + 1)
  }
  const counts = funnel.steps.map((_, index) => [...reached.values()].filter((done) => done > index).length)
  return {
    funnel,
    steps: funnel.steps.map((step, index) => {
      const previous = index === 0 ? undefined : counts[index - 1]
      const visitors = counts[index] ?? 0
      return {
        match: step.match,
        visitors,
        dropOff: previous === undefined || previous === 0 ? null : (previous - visitors) / previous,
      }
    }),
  }
}
