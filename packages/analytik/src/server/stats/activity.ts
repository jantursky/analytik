import { MINUTE } from '../../shared/time'
import type {
  EventRow,
  EventType,
  Page,
  Payment,
  Props,
  Realtime,
  SessionDetail,
  SessionSummary,
  VisitorProfile,
} from '../../shared/types'
import type { Context } from '../context'
import { type PaymentRow, toPayment } from '../payments'
import type { SiteRecord } from '../sites'
import type { EventsOptions, PageOptions } from '../types'
import { online } from './overview'
import { type StatsQuery, decodeCursor, filterSql, pageLimit, sessionWhere, toPage } from './query'

const FEED_WINDOW = 30 * MINUTE
const ACTIVE_WINDOW = 5 * MINUTE

interface SessionRow {
  id: string
  visitor_id: string
  started_at: number
  last_seen_at: number
  duration: number
  pageviews: number
  goals: number
  entry_page: string | null
  exit_page: string | null
  source: string
  channel: string
  country: string | null
  city: string | null
  browser: string | null
  os: string | null
  device: string | null
  revenue: number
}

interface StoredEvent {
  id: string
  ts: number
  type: EventType
  name: string | null
  path: string | null
  props: string | null
  session_id: string
  visitor_id: string
}

const SESSION_COLUMNS = `s.id, s.visitor_id, s.started_at, s.last_seen_at, s.duration, s.pageviews, s.goals, s.entry_page,
  s.exit_page, s.source, s.channel, s.country, s.city, s.browser, s.os, s.device,
  (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.site_id = s.site_id AND p.session_id = s.id
     AND p.currency = ?) AS revenue`

function toSummary(row: SessionRow): SessionSummary {
  return {
    id: row.id,
    visitorId: row.visitor_id,
    startedAt: row.started_at,
    durationMs: row.duration,
    pageviews: row.pageviews,
    goals: row.goals,
    entryPage: row.entry_page,
    exitPage: row.exit_page,
    source: row.source,
    channel: row.channel,
    country: row.country,
    city: row.city,
    browser: row.browser,
    os: row.os,
    device: row.device,
    revenue: row.revenue,
  }
}

function parseProps(text: string | null): Props | null {
  if (!text) return null
  try {
    return JSON.parse(text) as Props
  } catch {
    return null
  }
}

function toEvent(row: StoredEvent): EventRow {
  return {
    id: row.id,
    ts: row.ts,
    type: row.type,
    name: row.name,
    path: row.path,
    props: parseProps(row.props),
    sessionId: row.session_id,
    visitorId: row.visitor_id,
  }
}

/** Who is on the site now, what happened in the last 30 minutes, and where active visitors are. */
export async function realtime(ctx: Context, site: SiteRecord): Promise<Realtime> {
  const now = ctx.now()
  const [count, recent, locations] = await Promise.all([
    online(ctx, site.id),
    ctx.storage.query<{
      ts: number
      type: EventType
      name: string | null
      path: string | null
      country: string | null
    }>(
      `SELECT e.ts, e.type, e.name, e.path, s.country FROM events e
       LEFT JOIN sessions s ON s.site_id = e.site_id AND s.id = e.session_id
       WHERE e.site_id = ? AND e.ts > ? ORDER BY e.ts DESC, e.id DESC LIMIT 50`,
      [site.id, now - FEED_WINDOW],
    ),
    ctx.storage.query<{ lat: number; lon: number; country: string | null; city: string | null }>(
      `SELECT s.lat, s.lon, s.country, s.city FROM sessions s
       WHERE s.site_id = ? AND s.last_seen_at > ? AND s.lat IS NOT NULL AND s.lon IS NOT NULL
       ORDER BY s.last_seen_at DESC LIMIT 200`,
      [site.id, now - ACTIVE_WINDOW],
    ),
  ])
  return { online: count, recent, locations }
}

/** Sessions that started in the range, newest first. */
export async function sessions(
  ctx: Context,
  site: SiteRecord,
  query: StatsQuery,
  options: PageOptions = {},
): Promise<Page<SessionSummary>> {
  const limit = pageLimit(options.limit)
  const cursor = decodeCursor(options.cursor)
  const where = sessionWhere(site.id, query)
  const after = cursor ? ' AND (s.started_at < ? OR (s.started_at = ? AND s.id < ?))' : ''
  const rows = await ctx.storage.query<SessionRow>(
    `SELECT ${SESSION_COLUMNS} FROM sessions s WHERE ${where.sql}${after}
     ORDER BY s.started_at DESC, s.id DESC LIMIT ${limit + 1}`,
    [site.currency, ...where.params, ...(cursor ? [cursor.ts, cursor.ts, cursor.id] : [])],
  )
  return toPage(rows.map(toSummary), limit, (session) => ({ ts: session.startedAt, id: session.id }))
}

/** One session with its events and payments, and the visitor it belongs to. */
export async function sessionDetail(ctx: Context, site: SiteRecord, sessionId: string): Promise<SessionDetail | null> {
  const [row] = await ctx.storage.query<SessionRow>(
    `SELECT ${SESSION_COLUMNS} FROM sessions s WHERE s.site_id = ? AND s.id = ?`,
    [site.currency, site.id, sessionId],
  )
  if (!row) return null
  const [visitors, events, payments] = await Promise.all([
    ctx.storage.query<{
      id: string
      first_seen: number
      user_id: string | null
      name: string | null
      email: string | null
      sessions: number
    }>(
      `SELECT v.id, v.first_seen, v.user_id, v.name, v.email,
         (SELECT COUNT(*) FROM sessions x WHERE x.site_id = v.site_id AND x.visitor_id = v.id) AS sessions
       FROM visitors v WHERE v.site_id = ? AND v.id = ?`,
      [site.id, row.visitor_id],
    ),
    ctx.storage.query<StoredEvent>(
      'SELECT * FROM events WHERE site_id = ? AND session_id = ? ORDER BY ts, id LIMIT 1000',
      [site.id, sessionId],
    ),
    ctx.storage.query<PaymentRow>('SELECT * FROM payments WHERE site_id = ? AND session_id = ? ORDER BY ts', [
      site.id,
      sessionId,
    ]),
  ])
  const visitor = visitors[0]
  const profile: VisitorProfile | null = visitor
    ? {
        id: visitor.id,
        firstSeen: visitor.first_seen,
        userId: visitor.user_id,
        name: visitor.name,
        email: visitor.email,
        sessions: visitor.sessions,
      }
    : null
  return { session: toSummary(row), visitor: profile, events: events.map(toEvent), payments: payments.map(toPayment) }
}

/** Events in the range, newest first, optionally by name and type. Pings are never stored. */
export async function events(
  ctx: Context,
  site: SiteRecord,
  query: StatsQuery,
  options: EventsOptions = {},
): Promise<Page<EventRow>> {
  const limit = pageLimit(options.limit)
  const cursor = decodeCursor(options.cursor)
  const filters = filterSql(query.filters)
  let sql = `SELECT e.* FROM events e JOIN sessions s ON s.site_id = e.site_id AND s.id = e.session_id
    WHERE e.site_id = ? AND e.ts >= ? AND e.ts < ?${filters.sql}`
  const params: unknown[] = [site.id, query.from, query.to, ...filters.params]
  if (options.name) {
    sql += ' AND e.name = ?'
    params.push(options.name)
  }
  if (options.type) {
    sql += ' AND e.type = ?'
    params.push(options.type)
  }
  if (cursor) {
    sql += ' AND (e.ts < ? OR (e.ts = ? AND e.id < ?))'
    params.push(cursor.ts, cursor.ts, cursor.id)
  }
  const rows = await ctx.storage.query<StoredEvent>(`${sql} ORDER BY e.ts DESC, e.id DESC LIMIT ${limit + 1}`, params)
  return toPage(rows.map(toEvent), limit, (event) => ({ ts: event.ts, id: event.id }))
}

/** Payments and refunds in the range, newest first. */
export async function payments(
  ctx: Context,
  site: SiteRecord,
  query: StatsQuery,
  options: PageOptions = {},
): Promise<Page<Payment>> {
  const limit = pageLimit(options.limit)
  const cursor = decodeCursor(options.cursor)
  const params: unknown[] = [site.id, query.from, query.to]
  let sql = 'SELECT * FROM payments WHERE site_id = ? AND ts >= ? AND ts < ?'
  if (cursor) {
    sql += ' AND (ts < ? OR (ts = ? AND id < ?))'
    params.push(cursor.ts, cursor.ts, cursor.id)
  }
  const rows = await ctx.storage.query<PaymentRow>(`${sql} ORDER BY ts DESC, id DESC LIMIT ${limit + 1}`, params)
  return toPage(rows.map(toPayment), limit, (payment) => ({ ts: payment.ts, id: payment.id }))
}
