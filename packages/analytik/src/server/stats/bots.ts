import { classifyCrawler } from '../../shared/ua'
import { BOT_CATEGORIES, type BotCategory } from '../../shared/ua'
import { DAY } from '../../shared/time'
import type { BotFilters, BotRequest, BotStats } from '../../shared/types'
import { clip } from '../../shared/url'
import { placeholders } from '../../storage/sql/statements'
import type { Statement } from '../../storage/types'
import { AnalytikError, type Context } from '../context'
import type { SiteRecord } from '../sites'
import { BATCH_STATEMENTS } from '../import/core'
import { bucketTable } from './overview'
import { type Fragment, type StatsQuery, matchValues } from './query'

/** Requests accepted per call. */
export const BOT_BATCH_LIMIT = 500
const MAX_PATH = 500
const RECENT = 50
const TOP = 100

export interface BotInput {
  userAgent?: unknown
  path?: unknown
  ts?: unknown
}

/** The path without query or fragment, always starting with `/`; null when there is nothing usable. */
export function botPath(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return null
  const path = raw.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, '').split(/[?#]/)[0] ?? ''
  const clean = clip(path.startsWith('/') ? path : `/${path}`, MAX_PATH)
  return clean ?? null
}

/**
 * Records crawler requests. Entries from ordinary browsers are skipped. Only the crawler name, its category, the
 * path and the time are kept: no IP address, raw user agent or query string.
 */
export async function recordBots(
  ctx: Context,
  site: SiteRecord,
  input: unknown,
): Promise<{ recorded: number; skipped: number }> {
  if (!Array.isArray(input) || input.length === 0) throw new AnalytikError('requests must be a non-empty array')
  if (input.length > BOT_BATCH_LIMIT) throw new AnalytikError(`send at most ${BOT_BATCH_LIMIT} requests per call`)
  const now = ctx.now()
  // Reports older than retention would be purged straight away.
  const oldest = site.retentionDays ? now - site.retentionDays * DAY : 0
  const statements: Statement[] = []
  for (const entry of input as unknown[]) {
    const item: BotInput = entry && typeof entry === 'object' ? entry : {}
    const crawler = classifyCrawler(typeof item.userAgent === 'string' ? item.userAgent : null)
    const path = botPath(item.path)
    if (!crawler || !path) continue
    const sent = typeof item.ts === 'number' && Number.isFinite(item.ts) ? item.ts : now
    const ts = Math.max(oldest, Math.min(now, Math.trunc(sent)))
    statements.push({
      sql: 'INSERT INTO bot_requests (site_id, ts, crawler, category, path) VALUES (?, ?, ?, ?, ?)',
      params: [site.id, ts, crawler.name, crawler.category, path],
    })
  }
  for (let start = 0; start < statements.length; start += BATCH_STATEMENTS) {
    await ctx.storage.batch(statements.slice(start, start + BATCH_STATEMENTS))
  }
  return { recorded: statements.length, skipped: input.length - statements.length }
}

/** ` AND ...` conditions on bot rows (table alias `alias`) for the filters. */
function filterPart(filters: BotFilters, alias = ''): Fragment {
  const parts: string[] = []
  const params: unknown[] = []
  if (filters.crawler?.length) {
    parts.push(`${alias}crawler IN (${placeholders(filters.crawler.length)})`)
    params.push(...filters.crawler)
  }
  if (filters.category?.length) {
    parts.push(`${alias}category IN (${placeholders(filters.category.length)})`)
    params.push(...filters.category)
  }
  if (filters.page?.length) {
    const match = matchValues(`${alias}path`, filters.page)
    parts.push(match.sql)
    params.push(...match.params)
  }
  return { sql: parts.map((part) => ` AND ${part}`).join(''), params }
}

/** Parses the `crawler`, `category` and `page` query parameters. */
export function botFilters(params: URLSearchParams): BotFilters {
  const list = (name: string) =>
    params
      .getAll(name)
      .map((value) => value.slice(0, 500))
      .filter(Boolean)
  const category = list('category')
  if (category.some((value) => !(BOT_CATEGORIES as readonly string[]).includes(value))) {
    throw new AnalytikError(`category must be one of ${BOT_CATEGORIES.join(', ')}`)
  }
  return { crawler: list('crawler'), category: category as BotCategory[], page: list('page') }
}

export async function botStats(
  ctx: Context,
  site: SiteRecord,
  query: StatsQuery,
  filters: BotFilters,
): Promise<BotStats> {
  const filter = filterPart(filters)
  const base = {
    sql: `site_id = ? AND ts >= ? AND ts < ?${filter.sql}`,
    params: [site.id, query.from, query.to, ...filter.params],
  }
  const buckets = bucketTable(query)
  const seriesFilter = filterPart(filters, 'r.')
  const [series, categories, crawlers, pages, recent, any] = await Promise.all([
    ctx.storage.query<{ bucket: number; requests: number }>(
      `WITH ${buckets.sql}
       SELECT b.bucket, COUNT(r.ts) AS requests
       FROM b LEFT JOIN bot_requests r ON r.site_id = ? AND r.ts >= b.low AND r.ts < b.high${seriesFilter.sql}
       GROUP BY b.bucket`,
      [site.id, ...seriesFilter.params],
    ),
    ctx.storage.query<{ key: BotCategory; requests: number }>(
      `SELECT category AS key, COUNT(*) AS requests FROM bot_requests WHERE ${base.sql} GROUP BY category ORDER BY requests DESC`,
      base.params,
    ),
    ctx.storage.query<{ key: string; category: BotCategory; requests: number }>(
      `SELECT crawler AS key, MIN(category) AS category, COUNT(*) AS requests FROM bot_requests WHERE ${base.sql}
       GROUP BY crawler ORDER BY requests DESC, key LIMIT ${TOP}`,
      base.params,
    ),
    ctx.storage.query<{ key: string; requests: number }>(
      `SELECT path AS key, COUNT(*) AS requests FROM bot_requests WHERE ${base.sql}
       GROUP BY path ORDER BY requests DESC, key LIMIT ${TOP}`,
      base.params,
    ),
    ctx.storage.query<BotRequest>(
      `SELECT ts, crawler, category, path FROM bot_requests WHERE ${base.sql} ORDER BY ts DESC, path, crawler LIMIT ${RECENT}`,
      base.params,
    ),
    ctx.storage.query('SELECT 1 AS found FROM bot_requests WHERE site_id = ? LIMIT 1', [site.id]),
  ])
  const by = new Map(series.map((row) => [row.bucket, row.requests]))
  return {
    total: categories.reduce((sum, row) => sum + row.requests, 0),
    series: buckets.starts.map((ts) => ({ ts, requests: by.get(ts) ?? 0 })),
    categories,
    crawlers,
    pages,
    recent,
    hasData: any.length > 0,
  }
}
