import type { Context as HonoContext, Hono, MiddlewareHandler } from 'hono'

import { timingSafeEqual } from '../../shared/crypto'
import { DAY, HOUR, clampInterval, isValidTimeZone, parseDate } from '../../shared/time'
import type { Comparison, EventType, Interval } from '../../shared/types'
import { confirmDeletion, login, logout, me, requireAdmin } from '../auth'
import { isImportSource } from '../../shared/import/types'
import { AnalytikError, type Context } from '../context'
import { deleteTestSites, generateTestData } from '../debug'
import { sendTest } from '../email/notify'
import { getEmailSettings, saveEmailSettings } from '../email/settings'
import { createAnnotation, deleteAnnotation, updateAnnotation } from '../annotations'
import { applySync, previewSync, siteIcon } from '../site-sync'
import type { ShareLink } from '../../shared/types'
import { createShareLink, findShareLink, linkAllows, listShareLinks, revokeShareLink } from '../share'
import { importVisits } from '../import/core'
import { listImports, removeImport } from '../import/manage'
import { IMPORT_BODY_LIMIT, parseImportBody } from '../import/validate'
import { versionInfo } from '../version'
import { rematchPayments } from '../payments'
import { getPreferences, savePreferences } from '../preferences'
import { readText } from '../request'
import {
  type SiteRecord,
  applySiteDefaults,
  createSite,
  deleteSite,
  getSite,
  getSiteDefaults,
  listSites,
  publicSite,
  requireSite,
  rotateApiKey,
  saveSiteDefaults,
  updateSite,
} from '../sites'
import { events, payments, realtime, sessionDetail, sessions } from '../stats/activity'
import { botFilters, botStats } from '../stats/bots'
import { breakdown } from '../stats/breakdown'
import { EXPORT_TABLES, exportCsv, exportJson } from '../stats/export'
import { createFunnel, deleteFunnel, funnelResult, getFunnel, listFunnels } from '../stats/funnels'
import { overview, siteSummaries, timeseries } from '../stats/overview'
import { purgeBefore } from '../stats/purge'
import { targetProgress } from '../stats/targets'
import { journeys } from '../stats/journeys'
import { retention } from '../stats/retention'
import { vitalsResult } from '../stats/vitals'
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
const SHAREABLE =
  /^\/sites\/[^/]+\/(shared|favicon|overview|timeseries|breakdown|realtime|sessions|events|bots|funnels(\/[^/]+)?)$/

export interface AdminEnv {
  Variables: { site: SiteRecord; share: ShareLink | null }
}

async function body(c: HonoContext, limit = BODY_LIMIT): Promise<Record<string, unknown>> {
  const text = await readText(c.req.raw, limit)
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

/** How long a CDN may keep a response served through a share link, so a popular link does not hit the database each time. */
const SHARE_CACHE_SECONDS = 60
const PRIVATE_CACHE_SECONDS = 60
const JOURNEYS_CACHE_SECONDS = 300
const SHARE_CACHE_LIVE_SECONDS = 10

/**
 * Admin, or a GET carrying a share token on a read-only stats route. A link made in Settings is checked by its hash,
 * against its site, its views, its expiry and revocation; the older site-wide `shareToken` still opens every shareable
 * route. Only responses to a link's token in the address are cached publicly: the address is the cache key, so the key
 * holds the token and one link's response never answers another request.
 */
function siteAccess(ctx: Context): MiddlewareHandler<AdminEnv> {
  const admin = requireAdmin(ctx)
  return async (c, next) => {
    const id = c.req.param('id') ?? ''
    const fromAddress = c.req.query('share')
    const share = fromAddress ?? c.req.header('x-analytik-share')
    const route = c.req.path.slice(ctx.basePath.length)
    if (share && c.req.method === 'GET' && SHAREABLE.test(route)) {
      const site = await getSite(ctx, id)
      if (site) {
        const link = await findShareLink(ctx, id, share)
        const name = route.split('/')[3] ?? ''
        if (link && linkAllows(link.views, name)) {
          c.set('site', site)
          c.set('share', link)
          await next()
          if (fromAddress && c.res.status === 200) {
            const seconds = name === 'realtime' ? SHARE_CACHE_LIVE_SECONDS : SHARE_CACHE_SECONDS
            c.res.headers.set('cache-control', `public, s-maxage=${seconds}`)
          }
          return
        }
        if (!link && site.shareToken && timingSafeEqual(share, site.shareToken)) {
          c.set('site', site)
          c.set('share', null)
          return next()
        }
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

  // Owner emails: whether a sender is configured, the settings chosen here and a test send.
  app.use('/email', requireAdmin(ctx))
  app.use('/email/*', requireAdmin(ctx))
  app.get('/email', async (c) =>
    c.json({ configured: ctx.email !== undefined, to: ctx.email?.to ?? null, settings: await getEmailSettings(ctx) }),
  )
  app.put('/email', async (c) => c.json(await saveEmailSettings(ctx, await body(c))))
  app.post('/email/test', async (c) => {
    if (!ctx.email) throw new AnalytikError('no email sender is configured; pass email to createAnalytik()')
    const input = await body(c)
    const to = typeof input.to === 'string' && input.to ? input.to : (await getEmailSettings(ctx)).to || ctx.email.to
    if (!to || !/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(to)) throw new AnalytikError('enter a recipient address')
    try {
      await sendTest(ctx, to)
    } catch (error) {
      throw new AnalytikError(error instanceof Error ? error.message : 'the email sender failed', 502)
    }
    return c.json({ ok: true, to })
  })

  app.use('/debug', requireAdmin(ctx))
  app.use('/debug/*', requireAdmin(ctx))
  app.get('/debug', (c) => c.json({ enabled: ctx.debug }))
  app.use('/debug/*', async (_c, next) => {
    if (!ctx.debug) throw new AnalytikError('debug tools are off; pass debug: true to createAnalytik()', 404)
    await next()
  })
  app.post('/debug/generate', async (c) => c.json(await generateTestData(ctx, await body(c))))
  app.delete('/debug/sites', async (c) => c.json(await deleteTestSites(ctx)))

  // The address this request comes from as the server sees it, so "Add my IP" adds what ingest will match.
  app.use('/my-ip', requireAdmin(ctx))
  app.get('/my-ip', (c) => c.json({ ip: ctx.clientIp(c.req.raw) }))

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
    // `series=hour|day` adds a visitors and a revenue series per site; `compare=1` the totals of the window before.
    const series = c.req.query('series')
    if (series !== undefined && series !== 'hour' && series !== 'day') {
      throw new AnalytikError('series must be hour or day')
    }
    const bucket = series === 'hour' ? HOUR : series === 'day' ? DAY : undefined
    return c.json(
      await siteSummaries(ctx, await listSites(ctx), from, to, { bucket, compare: c.req.query('compare') === '1' }),
    )
  })

  // What new sites start with, and the button that copies it onto the existing ones.
  app.use('/site-defaults', requireAdmin(ctx))
  app.use('/site-defaults/*', requireAdmin(ctx))
  app.get('/site-defaults', async (c) => c.json(await getSiteDefaults(ctx)))
  app.put('/site-defaults', async (c) => c.json(await saveSiteDefaults(ctx, await body(c))))
  app.post('/site-defaults/apply', async (c) => {
    const { groups } = await body(c)
    return c.json({ updated: await applySiteDefaults(ctx, groups) })
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

  // What a shared dashboard needs to start: the site's name, domain and formats, and which views the link shows.
  app.get('/sites/:id/shared', (c) => {
    const { id, name, domain, timezone, currency, privacyMode, createdAt, color, iconHash } = c.get('site')
    return c.json({
      site: { id, name, domain, timezone, currency, privacyMode, createdAt, color, iconHash },
      views: c.get('share')?.views ?? [],
    })
  })
  app.get('/sites/:id/favicon', async (c) => (await siteIcon(ctx, c.get('site'), c.req.raw)) ?? c.body(null, 404))
  // Reads the site's own page: the preview changes nothing, apply takes over the fields the caller lists.
  app.post('/sites/:id/sync', async (c) => c.json(await previewSync(c.get('site'), c.req.raw)))
  app.post('/sites/:id/sync/apply', async (c) => {
    const { site, applied } = await applySync(ctx, c.get('site'), (await body(c)).fields, c.req.raw)
    return c.json({ site: publicSite(site), applied })
  })
  app.get('/sites/:id/overview', async (c) => c.json(await overview(ctx, c.get('site'), query(c))))
  app.get('/sites/:id/timeseries', async (c) => c.json(await timeseries(ctx, c.get('site'), query(c))))
  app.get('/sites/:id/breakdown', async (c) => {
    const dimension = c.req.query('dimension') ?? ''
    if (!isDimension(dimension)) throw new AnalytikError(`dimension must be one of ${DIMENSIONS.join(', ')}`)
    return c.json(await breakdown(ctx, c.get('site'), dimension, query(c), limitParam(c, 100)))
  })
  app.get('/sites/:id/bots', async (c) =>
    c.json(await botStats(ctx, c.get('site'), query(c), botFilters(new URL(c.req.url).searchParams))),
  )
  // Targets count in their own period, not the toolbar's range, and move slowly, so the browser may keep the answer
  // briefly. Admin only: a target is a business goal, so a share link never reads it.
  app.get('/sites/:id/targets', async (c) => {
    const result = await targetProgress(ctx, c.get('site'))
    c.header('cache-control', `private, max-age=${PRIVATE_CACHE_SECONDS}`)
    return c.json(result)
  })
  // Percentiles over a range are worth keeping for a minute: the same reports answer the same way.
  app.get('/sites/:id/vitals', async (c) => {
    const result = await vitalsResult(ctx, c.get('site'), query(c))
    c.header('cache-control', `private, max-age=${PRIVATE_CACHE_SECONDS}`)
    return c.json(result)
  })
  // The costliest read: the newest sessions' first pages. The same answer is kept for a few minutes; admin only.
  app.get('/sites/:id/journeys', async (c) => {
    const result = await journeys(ctx, c.get('site'), query(c))
    c.header('cache-control', `private, max-age=${JOURNEYS_CACHE_SECONDS}`)
    return c.json(result)
  })
  // One aggregate over at most 12 weekly cohorts; the same answer is kept for a few minutes; admin only.
  app.get('/sites/:id/retention', async (c) => {
    const result = await retention(ctx, c.get('site'), query(c))
    c.header('cache-control', `private, max-age=${JOURNEYS_CACHE_SECONDS}`)
    return c.json(result)
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

  // Read-only links to this site's dashboard. Admin only: a link cannot list, create or revoke links.
  app.get('/sites/:id/share-links', async (c) => c.json(await listShareLinks(ctx, c.get('site').id)))
  app.post('/sites/:id/share-links', async (c) =>
    c.json(await createShareLink(ctx, c.get('site').id, await body(c)), 201),
  )
  app.delete('/sites/:id/share-links/:lid', async (c) => {
    if (!(await revokeShareLink(ctx, c.get('site').id, c.req.param('lid')))) {
      throw new AnalytikError('link not found', 404)
    }
    return c.json({ ok: true })
  })

  // Dated notes on the charts. They are read through the timeseries; a share link can read them but not change them.
  app.post('/sites/:id/annotations', async (c) =>
    c.json(await createAnnotation(ctx, c.get('site').id, await body(c)), 201),
  )
  app.patch('/sites/:id/annotations/:nid', async (c) => {
    const note = await updateAnnotation(ctx, c.get('site').id, c.req.param('nid'), await body(c))
    if (!note) throw new AnalytikError('note not found', 404)
    return c.json(note)
  })
  app.delete('/sites/:id/annotations/:nid', async (c) => {
    if (!(await deleteAnnotation(ctx, c.get('site').id, c.req.param('nid')))) {
      throw new AnalytikError('note not found', 404)
    }
    return c.json({ ok: true })
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

  // History from another tool. The browser sends it in chunks; every row is checked and rebuilt from known fields.
  app.get('/sites/:id/imports', async (c) => c.json(await listImports(ctx, c.get('site').id)))
  app.post('/sites/:id/import', async (c) => {
    const { source, visits } = parseImportBody(await body(c, IMPORT_BODY_LIMIT), ctx.now())
    return c.json(await importVisits(ctx, c.get('site'), source, visits))
  })
  app.delete('/sites/:id/imports/:source', async (c) => {
    const source = c.req.param('source')
    if (!isImportSource(source)) throw new AnalytikError('unknown import source', 404)
    return c.json(await removeImport(ctx, c.get('site').id, source))
  })

  app.delete('/sites/:id/data', async (c) => {
    const site = c.get('site')
    const raw = c.req.query('before') ?? ''
    const before = /^\d+$/.test(raw) ? Number(raw) : parseDate(raw, site.timezone)
    if (before === null) throw new AnalytikError('before must be an ISO 8601 date or unix ms')
    return c.json(await purgeBefore(ctx, site.id, before))
  })
}
