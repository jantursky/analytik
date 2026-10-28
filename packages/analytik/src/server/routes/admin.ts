import type { Context as HonoContext, Hono, MiddlewareHandler } from 'hono'

import { timingSafeEqual } from '../../shared/crypto'
import { DAY, clampInterval, isValidTimeZone, parseDate } from '../../shared/time'
import type { Comparison, EventType, Interval } from '../../shared/types'
import { confirmDeletion, login, logout, me, requireAdmin } from '../auth'
import { AnalytikError, type Context } from '../context'
import { deleteTestSites, generateTestData } from '../debug'
import { siteFavicon } from '../favicon'
import { versionInfo } from '../version'
import { rematchPayments } from '../payments'
import { getPreferences, savePreferences } from '../preferences'
import { readText } from '../request'
import {
  type SiteRecord,
  createSite,
  deleteSite,
  getSite,
  listSites,
  publicSite,
  requireSite,
  rotateApiKey,
  updateSite,
} from '../sites'
import { events, payments, realtime, sessionDetail, sessions } from '../stats/activity'
import { breakdown } from '../stats/breakdown'
import { EXPORT_TABLES, exportCsv, exportJson } from '../stats/export'
import { createFunnel, deleteFunnel, funnelResult, getFunnel, listFunnels } from '../stats/funnels'
import { overview, siteSummaries, timeseries } from '../stats/overview'
import { purgeBefore } from '../stats/purge'
import {
  COMPARISONS,
  DIMENSIONS,
  type FilterValues,
  type StatsQuery,
  defaultRange,
  isDimension,
  pageLimit,
} from '../stats/query'
import type { ExportTable, PageOptions } from '../types'

const BODY_LIMIT = 64 * 1024
const INTERVALS: readonly Interval[] = ['hour', 'day', 'week', 'month']
const EVENT_TYPES: readonly EventType[] = ['pageview', 'goal', 'outbound', 'identify', 'revenue']

/**
 * Stats a share link may read: aggregates and the session list. Payments and session details carry
 * names and emails, so they stay admin-only, like settings, export and writes.
 */
const SHAREABLE = /^\/sites\/[^/]+\/(overview|timeseries|breakdown|realtime|sessions|events|funnels(\/[^/]+)?)$/

export interface AdminEnv {
  Variables: { site: SiteRecord }
}

async function body(c: HonoContext): Promise<Record<string, unknown>> {
  const text = await readText(c.req.raw, BODY_LIMIT)
  if (text === null) throw new AnalytikError('payload too large', 413)
  try {
    const value = JSON.parse(text || '{}') as unknown
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  } catch {
    // Reported below.
  }
  throw new AnalytikError('body must be a JSON object')
}

/** `from`, `to`, `interval`, `tz` and dimension filters from the query string. */
export function statsQuery(url: URL, site: SiteRecord, now: number): StatsQuery {
  const params = url.searchParams
  const tz = params.get('tz') ?? site.timezone
  if (!isValidTimeZone(tz)) throw new AnalytikError('tz must be an IANA time zone')
  const range = defaultRange(now, tz)
  const fromParam = params.get('from')
  const toParam = params.get('to')
  const from = fromParam ? parseDate(fromParam, tz) : range.from
  const to = toParam ? parseDate(toParam, tz, true) : range.to
  if (from === null || to === null) throw new AnalytikError('from and to must be ISO 8601 dates')
  if (from >= to) throw new AnalytikError('from must be before to')
  const interval = params.get('interval') as Interval | null
  const filters: FilterValues = {}
  for (const dimension of DIMENSIONS) {
    const values = params.getAll(dimension).map((value) => value.slice(0, 500))
    if (values.length > 0) filters[dimension] = values
  }
  const compare = params.get('compare')
  return {
    from,
    to,
    interval: clampInterval(from, to, interval && INTERVALS.includes(interval) ? interval : undefined),
    tz,
    filters,
    ...(compare && COMPARISONS.includes(compare as Comparison) && { compare: compare as Comparison }),
  }
}

const limitParam = (c: HonoContext, fallback = 50) => pageLimit(Number(c.req.query('limit') ?? fallback))

/** Paging, order and search of a list route: `cursor` or `offset`, `limit`, `sort`, `order`, `search`. */
function pageParams(c: HonoContext): PageOptions {
  const order = c.req.query('order')
  if (order !== undefined && order !== 'asc' && order !== 'desc') throw new AnalytikError('order must be asc or desc')
  const offset = c.req.query('offset')
  if (offset !== undefined && !/^\d+$/.test(offset)) throw new AnalytikError('offset must be a whole number')
  return {
    cursor: c.req.query('cursor'),
    limit: limitParam(c),
    offset: offset === undefined ? undefined : Number(offset),
    sort: c.req.query('sort'),
    order,
    search: c.req.query('search'),
    visitor: c.req.query('visitor'),
  }
}

/** Admin, or a GET carrying the site's share token on a read-only stats route. */
function siteAccess(ctx: Context): MiddlewareHandler<AdminEnv> {
  const admin = requireAdmin(ctx)
  return async (c, next) => {
    const id = c.req.param('id') ?? ''
    const share = c.req.query('share') ?? c.req.header('x-analytik-share')
    if (share && c.req.method === 'GET' && SHAREABLE.test(c.req.path.slice(ctx.basePath.length))) {
      const site = await getSite(ctx, id)
      if (site?.shareToken && timingSafeEqual(share, site.shareToken)) {
        c.set('site', site)
        return next()
      }
    }
    return admin(c, async () => {
      c.set('site', await requireSite(ctx, id))
      await next()
    })
  }
}

/** Login, dashboard preferences, debug data, sites, stats, funnels, payments, export and retention. */
export function adminRoutes(app: Hono<AdminEnv>, ctx: Context): void {
  app.post('/auth/login', async (c) => login(ctx, c, (await body(c)).password))
  app.post('/auth/logout', (c) => logout(ctx, c))
  app.get('/auth/me', (c) => me(ctx, c))

  app.use('/preferences', requireAdmin(ctx))
  app.get('/preferences', async (c) => c.json(await getPreferences(ctx)))
  app.put('/preferences', async (c) => c.json(await savePreferences(ctx, await body(c))))

  app.use('/debug', requireAdmin(ctx))
  app.use('/debug/*', requireAdmin(ctx))
  app.get('/debug', (c) => c.json({ enabled: ctx.debug }))
  app.use('/debug/*', async (_c, next) => {
    if (!ctx.debug) throw new AnalytikError('debug tools are off; pass debug: true to createAnalytik()', 404)
    await next()
  })
  app.post('/debug/generate', async (c) => c.json(await generateTestData(ctx, await body(c))))
  app.delete('/debug/sites', async (c) => c.json(await deleteTestSites(ctx)))

  app.use('/version', requireAdmin(ctx))
  app.get('/version', async (c) => c.json(await versionInfo(ctx)))

  // Every site's headline numbers in one request, for the sites overview. Default the last 24 hours.
  app.use('/summary', requireAdmin(ctx))
  app.get('/summary', async (c) => {
    const now = ctx.now()
    const from = c.req.query('from') ? parseDate(c.req.query('from') ?? '', 'UTC') : now - DAY
    const to = c.req.query('to') ? parseDate(c.req.query('to') ?? '', 'UTC', true) : now
    if (from === null || to === null) throw new AnalytikError('from and to must be ISO 8601 dates')
    if (from >= to) throw new AnalytikError('from must be before to')
    return c.json(await siteSummaries(ctx, await listSites(ctx), from, to))
  })

  app.use('/sites', requireAdmin(ctx))
  app.use('/sites/:id', siteAccess(ctx))
  app.use('/sites/:id/*', siteAccess(ctx))

  app.get('/sites', async (c) => c.json((await listSites(ctx)).map(publicSite)))
  app.post('/sites', async (c) => {
    const { site, apiKey } = await createSite(ctx, await body(c))
    return c.json({ site: publicSite(site), apiKey }, 201)
  })
  app.get('/sites/:id', (c) => c.json(publicSite(c.get('site'))))
  app.patch('/sites/:id', async (c) => c.json(publicSite(await updateSite(ctx, c.get('site').id, await body(c)))))
  app.delete('/sites/:id', async (c) => {
    const site = c.get('site')
    await confirmDeletion(ctx, c, site.domain, await body(c))
    await deleteSite(ctx, site.id)
    return c.json({ ok: true })
  })
  app.post('/sites/:id/rotate-key', async (c) => c.json({ apiKey: await rotateApiKey(ctx, c.get('site').id) }))

  const query = (c: HonoContext<AdminEnv>) => statsQuery(new URL(c.req.url), c.get('site'), ctx.now())

  app.get('/sites/:id/favicon', async (c) => (await siteFavicon(c.get('site').domain)) ?? c.body(null, 404))
  app.get('/sites/:id/overview', async (c) => c.json(await overview(ctx, c.get('site'), query(c))))
  app.get('/sites/:id/timeseries', async (c) => c.json(await timeseries(ctx, c.get('site'), query(c))))
  app.get('/sites/:id/breakdown', async (c) => {
    const dimension = c.req.query('dimension') ?? ''
    if (!isDimension(dimension)) throw new AnalytikError(`dimension must be one of ${DIMENSIONS.join(', ')}`)
    return c.json(await breakdown(ctx, c.get('site'), dimension, query(c), limitParam(c, 100)))
  })
  app.get('/sites/:id/realtime', async (c) => c.json(await realtime(ctx, c.get('site'))))
  app.get('/sites/:id/sessions', async (c) => c.json(await sessions(ctx, c.get('site'), query(c), pageParams(c))))
  app.get('/sites/:id/sessions/:sid', async (c) => {
    const detail = await sessionDetail(ctx, c.get('site'), c.req.param('sid'))
    if (!detail) throw new AnalytikError('session not found', 404)
    return c.json(detail)
  })
  app.get('/sites/:id/events', async (c) => {
    const type = c.req.query('type') as EventType | undefined
    if (type !== undefined && !EVENT_TYPES.includes(type)) throw new AnalytikError('unknown event type')
    return c.json(await events(ctx, c.get('site'), query(c), { ...pageParams(c), name: c.req.query('name'), type }))
  })

  app.get('/sites/:id/funnels', async (c) => c.json(await listFunnels(ctx, c.get('site').id)))
  app.post('/sites/:id/funnels', async (c) => c.json(await createFunnel(ctx, c.get('site').id, await body(c)), 201))
  app.get('/sites/:id/funnels/:fid', async (c) => {
    const funnel = await getFunnel(ctx, c.get('site').id, c.req.param('fid'))
    if (!funnel) throw new AnalytikError('funnel not found', 404)
    return c.json(await funnelResult(ctx, c.get('site'), funnel, query(c)))
  })
  app.delete('/sites/:id/funnels/:fid', async (c) => {
    if (!(await deleteFunnel(ctx, c.get('site').id, c.req.param('fid'))))
      throw new AnalytikError('funnel not found', 404)
    return c.json({ ok: true })
  })

  app.get('/sites/:id/payments', async (c) => {
    const kind = c.req.query('kind')
    if (kind !== undefined && kind !== 'payment' && kind !== 'refund')
      throw new AnalytikError('kind must be payment or refund')
    const attributed = c.req.query('attributed')
    if (attributed !== undefined && attributed !== 'true' && attributed !== 'false') {
      throw new AnalytikError('attributed must be true or false')
    }
    return c.json(
      await payments(ctx, c.get('site'), query(c), {
        ...pageParams(c),
        kind,
        provider: c.req.query('provider'),
        attributed: attributed === undefined ? undefined : attributed === 'true',
      }),
    )
  })
  app.post('/sites/:id/rematch', async (c) => c.json(await rematchPayments(ctx, c.get('site'))))

  app.get('/sites/:id/export', async (c) => {
    const site = c.get('site')
    const format = c.req.query('format') ?? 'json'
    const date = new Date(ctx.now()).toISOString().slice(0, 10)
    if (format === 'json') {
      c.header('content-disposition', `attachment; filename="analytik-${site.id}-${date}.json"`)
      return c.body(await exportJson(ctx, site), 200, { 'content-type': 'application/json' })
    }
    const table = (c.req.query('table') ?? 'events') as ExportTable
    if (format !== 'csv' || !EXPORT_TABLES.includes(table)) throw new AnalytikError('format must be json or csv')
    c.header('content-disposition', `attachment; filename="analytik-${site.id}-${table}-${date}.csv"`)
    return c.body(await exportCsv(ctx, site, table), 200, { 'content-type': 'text/csv; charset=utf-8' })
  })

  app.delete('/sites/:id/data', async (c) => {
    const site = c.get('site')
    const raw = c.req.query('before') ?? ''
    const before = /^\d+$/.test(raw) ? Number(raw) : parseDate(raw, site.timezone)
    if (before === null) throw new AnalytikError('before must be an ISO 8601 date or unix ms')
    return c.json(await purgeBefore(ctx, site.id, before))
  })
}
