import { fromBase64, toBase64Url } from '../../shared/crypto'
import { DAY, clampInterval, isValidTimeZone, startOfBucket } from '../../shared/time'
import { DIMENSIONS } from '../../shared/dimensions'
import type { Dimension, Filters, Interval, Page, Query } from '../../shared/types'
import { placeholders } from '../../storage/sql/statements'
import { AnalytikError, type Context } from '../context'
import type { SiteRecord } from '../sites'
import type { PageOptions } from '../types'

export { DIMENSIONS }

/** Dimensions stored on the session row, and their column. */
export const SESSION_COLUMNS: Partial<Record<Dimension, string>> = {
  channel: 'channel',
  source: 'source',
  referrer: 'referrer_domain',
  campaign: 'utm_campaign',
  medium: 'utm_medium',
  term: 'utm_term',
  content: 'utm_content',
  ref: 'ref',
  entry: 'entry_page',
  exit: 'exit_page',
  country: 'country',
  region: 'region',
  city: 'city',
  browser: 'browser',
  os: 'os',
  device: 'device',
}

/** Dimensions that come from events: the event type and the column holding the key. */
export const EVENT_DIMENSIONS: Partial<Record<Dimension, { type: string; column: 'path' | 'name' }>> = {
  page: { type: 'pageview', column: 'path' },
  event: { type: 'goal', column: 'name' },
  goal: { type: 'goal', column: 'name' },
  outbound: { type: 'outbound', column: 'name' },
}

/** Filter values per dimension; several values for one dimension match any of them. */
export type FilterValues = Partial<Record<Dimension, string[]>>

export interface StatsQuery {
  from: number
  to: number
  interval: Interval
  tz: string
  filters: FilterValues
}

export interface Fragment {
  sql: string
  params: unknown[]
}

export function isDimension(value: string): value is Dimension {
  return (DIMENSIONS as readonly string[]).includes(value)
}

/**
 * `column` starts with `prefix`, compared with `substr` instead of LIKE so it is case-sensitive on every
 * database, like exact matches. Both count characters (code points); the length is an integer computed
 * here, so inlining it is safe.
 */
export function prefixMatch(column: string, prefix: string): Fragment {
  return { sql: `substr(${column}, 1, ${Array.from(prefix).length}) = ?`, params: [prefix] }
}

/** `''` matches unknown (NULL), a trailing `*` matches a prefix, anything else matches exactly. */
function matchValues(column: string, values: string[]): Fragment {
  const parts: string[] = []
  const params: unknown[] = []
  const exact: string[] = []
  for (const value of values) {
    if (value === '') parts.push(`${column} IS NULL`)
    else if (value.endsWith('*')) {
      const prefix = prefixMatch(column, value.slice(0, -1))
      parts.push(prefix.sql)
      params.push(...prefix.params)
    } else exact.push(value)
  }
  if (exact.length > 0) {
    parts.push(`${column} IN (${placeholders(exact.length)})`)
    params.push(...exact)
  }
  return { sql: `(${parts.join(' OR ')})`, params }
}

/** ` AND ...` conditions restricting sessions `s` by the filters. */
export function filterSql(filters: FilterValues): Fragment {
  const parts: string[] = []
  const params: unknown[] = []
  for (const [dimension, values] of Object.entries(filters) as [Dimension, string[]][]) {
    if (values.length === 0) continue
    const column = SESSION_COLUMNS[dimension]
    const event = EVENT_DIMENSIONS[dimension]
    if (column) {
      const match = matchValues(`s.${column}`, values)
      parts.push(match.sql)
      params.push(...match.params)
    } else if (event) {
      const match = matchValues(`fe.${event.column}`, values)
      parts.push(
        `EXISTS (SELECT 1 FROM events fe WHERE fe.site_id = s.site_id AND fe.session_id = s.id AND fe.type = ? AND ${match.sql})`,
      )
      params.push(event.type, ...match.params)
    }
  }
  return { sql: parts.map((part) => ` AND ${part}`).join(''), params }
}

export function hasFilters(filters: FilterValues): boolean {
  return Object.values(filters).some((values) => values.length > 0)
}

/** Sessions of the site that started in `[from, to)` and match the filters. */
export function sessionWhere(siteId: string, query: StatsQuery, from = query.from, to = query.to): Fragment {
  const filters = filterSql(query.filters)
  return {
    sql: `s.site_id = ? AND s.started_at >= ? AND s.started_at < ?${filters.sql}`,
    params: [siteId, from, to, ...filters.params],
  }
}

/** Turns the public `Query` into the validated internal form, defaulting to the site's timezone. */
export function toStatsQuery(site: SiteRecord, query: Query): StatsQuery {
  const tz = query.tz ?? site.timezone
  if (!isValidTimeZone(tz)) throw new AnalytikError('tz must be an IANA time zone')
  if (!Number.isFinite(query.from) || !Number.isFinite(query.to) || query.from >= query.to) {
    throw new AnalytikError('from must be before to')
  }
  const filters: FilterValues = {}
  for (const [key, value] of Object.entries(query.filters ?? ({} satisfies Filters))) {
    if (value !== undefined && isDimension(key)) filters[key] = [value]
  }
  return { from: query.from, to: query.to, interval: clampInterval(query.from, query.to, query.interval), tz, filters }
}

/** The last 30 days including today, in the given timezone. */
export function defaultRange(now: number, tz: string): { from: number; to: number } {
  return { from: startOfBucket(now - 29 * DAY, 'day', tz), to: now }
}

export function pageLimit(limit: number | undefined): number {
  return Math.max(1, Math.min(500, Math.trunc(limit ?? 50) || 50))
}

const decoder = new TextDecoder()
const encoder = new TextEncoder()

/** Opaque keyset cursor: the sort timestamp and id of the last row returned. */
export function encodeCursor(ts: number, id: string): string {
  return toBase64Url(encoder.encode(JSON.stringify([ts, id])))
}

export function decodeCursor(cursor: string | null | undefined): { ts: number; id: string } | null {
  if (!cursor) return null
  try {
    const value = JSON.parse(decoder.decode(fromBase64(cursor.replace(/-/g, '+').replace(/_/g, '/')))) as unknown
    if (Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'string') {
      return { ts: value[0], id: value[1] }
    }
  } catch {
    // Fall through to the error below.
  }
  throw new AnalytikError('cursor is invalid')
}

/** ` AND (...)`: any of `columns` contains `search`, ignoring case. LIKE wildcards in the search are literal. */
export function searchSql(columns: readonly string[], search: string | undefined): Fragment {
  const term = search?.trim().toLowerCase()
  if (!term) return { sql: '', params: [] }
  const pattern = `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
  return {
    sql: ` AND (${columns.map((column) => `LOWER(${column}) LIKE ? ESCAPE '\\'`).join(' OR ')})`,
    params: columns.map(() => pattern),
  }
}

/** How a list can be searched and sorted. */
export interface ListSpec {
  /** Sort keys and the SQL each orders by; nullable ones sort their unknowns last. */
  sorts: Record<string, { sql: string; nullable?: boolean }>
  /** The time and id columns: the default order (newest first) and the keyset cursor. */
  time: string
  id: string
  /** Text columns `search` looks in. */
  search: readonly string[]
}

export interface ListQuery {
  select: string
  /** Parameters of placeholders inside `select`, which come before the WHERE clause. */
  selectParams?: unknown[]
  from: string
  where: Fragment
}

/**
 * One page of a list with the total: numbered pages (`offset`) in any order, or keyset pages (`cursor`) in the
 * default order. Sort keys are looked up in `spec`, so no user text reaches the SQL.
 */
export async function listPage<R, T>(
  ctx: Context,
  query: ListQuery,
  spec: ListSpec,
  options: PageOptions,
  toItem: (row: R) => T,
  key: (row: R) => { ts: number; id: string },
): Promise<Page<T>> {
  const limit = pageLimit(options.limit)
  const offset = Math.max(0, Math.trunc(options.offset ?? 0) || 0)
  const order = options.order === 'asc' ? 'ASC' : 'DESC'
  const sort = options.sort === undefined ? undefined : spec.sorts[options.sort]
  if (options.sort !== undefined && !sort) {
    throw new AnalytikError(`sort must be one of ${Object.keys(spec.sorts).join(', ')}`)
  }
  const keyset = !sort && order === 'DESC' && offset === 0
  const cursor = decodeCursor(options.cursor)
  if (cursor && !keyset) throw new AnalytikError('cursor works only in the default order and without offset')

  const search = searchSql(spec.search, options.search)
  const where = `${query.where.sql}${search.sql}`
  const params = [...query.where.params, ...search.params]
  const after = cursor ? ` AND (${spec.time} < ? OR (${spec.time} = ? AND ${spec.id} < ?))` : ''
  const orderBy = sort
    ? `${sort.nullable ? `${sort.sql} IS NULL, ` : ''}${sort.sql} ${order}, ${spec.time} DESC, ${spec.id} DESC`
    : `${spec.time} ${order}, ${spec.id} ${order}`
  const [rows, counted] = await Promise.all([
    ctx.storage.query<R>(
      `SELECT ${query.select} FROM ${query.from} WHERE ${where}${after}
       ORDER BY ${orderBy} LIMIT ${limit + 1}${offset ? ` OFFSET ${offset}` : ''}`,
      [...(query.selectParams ?? []), ...params, ...(cursor ? [cursor.ts, cursor.ts, cursor.id] : [])],
    ),
    // Drivers return COUNT as a number or, for 64-bit counts, a string.
    ctx.storage.query<{ total: number | string }>(`SELECT COUNT(*) AS total FROM ${query.from} WHERE ${where}`, params),
  ])
  const page = toPage(rows, limit, key)
  return {
    items: page.items.map(toItem),
    nextCursor: keyset ? page.nextCursor : null,
    total: Number(counted[0]?.total ?? 0),
  }
}

/** Returns the page and the cursor for the next one; rows were fetched with `limit + 1`. */
export function toPage<T>(rows: T[], limit: number, key: (row: T) => { ts: number; id: string }) {
  const items = rows.slice(0, limit)
  const last = items.at(-1)
  const next = rows.length > limit && last ? key(last) : null
  return { items, nextCursor: next ? encodeCursor(next.ts, next.id) : null }
}

/** `previous → value` with the relative change, null when there is nothing to compare against. */
export function delta(value: number, previous: number) {
  return { value, previous, change: previous === 0 ? null : (value - previous) / previous }
}

export const ratio = (part: number, whole: number): number => (whole === 0 ? 0 : part / whole)
