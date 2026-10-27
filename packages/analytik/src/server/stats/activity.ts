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
import type { EventsOptions, PageOptions, PaymentsOptions } from '../types'
import { online } from './overview'
import { type ListSpec, type StatsQuery, filterSql, listPage, sessionWhere } from './query'

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
       LEFT JOIN sessions s ON s.id = e.session_id AND s.site_id = e.site_id
       WHERE e.site_id = ? AND e.ts > ? ORDER BY e.ts DESC, e.id DESC LIMIT 50`,
      [site.id, now - FEED_WINDOW],
    ),
    ctx.storage.query<{
      lat: number
      lon: number
      country: string | null
      city: string | null
      session_id: string
      visitor_id: string
      page: string | null
      source: string
      browser: string | null
      device: string | null
      started_at: number | string
      last_seen_at: number | string
    }>(
      `SELECT s.lat, s.lon, s.country, s.city, s.id AS session_id, s.visitor_id, s.exit_page AS page, s.source,
         s.browser, s.device, s.started_at, s.last_seen_at FROM sessions s
       WHERE s.site_id = ? AND s.last_seen_at > ? AND s.lat IS NOT NULL AND s.lon IS NOT NULL
       ORDER BY s.last_seen_at DESC LIMIT 200`,
      [site.id, now - ACTIVE_WINDOW],
    ),
  ])
  return {
    online: count,
    recent,
    locations: locations.map((l) => ({
      lat: l.lat,
      lon: l.lon,
      country: l.country,
      city: l.city,
      sessionId: l.session_id,
      visitorId: l.visitor_id,
      page: l.page,
      source: l.source,
      browser: l.browser,
      device: l.device,
      startedAt: Number(l.started_at),
      lastSeen: Number(l.last_seen_at),
    })),
  }
}

const SESSION_LIST: ListSpec = {
  sorts: {
    time: { sql: 's.started_at' },
    duration: { sql: 's.duration' },
    pageviews: { sql: 's.pageviews' },
    source: { sql: 's.source' },
    country: { sql: 's.country', nullable: true },
    entry: { sql: 's.entry_page', nullable: true },
    revenue: { sql: 'revenue' },
  },
  time: 's.started_at',
  id: 's.id',
  search: [
    's.entry_page',
    's.exit_page',
    's.source',
    's.channel',
    's.country',
    's.city',
    's.browser',
    's.os',
    's.visitor_id',
  ],
}

/** Sessions that started in the range, newest first unless sorted otherwise. */
export function sessions(
  ctx: Context,
  site: SiteRecord,
  query: StatsQuery,
  options: PageOptions = {},
): Promise<Page<SessionSummary>> {
  const where = sessionWhere(site.id, query)
  if (options.visitor) {
    where.sql += ' AND s.visitor_id = ?'
    where.params.push(options.visitor)
  }
  return listPage<SessionRow, SessionSummary>(
    ctx,
    { select: SESSION_COLUMNS, selectParams: [site.currency], from: 'sessions s', where },
    SESSION_LIST,
    options,
    toSummary,
    (row) => ({ ts: row.started_at, id: row.id }),
  )
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

const EVENT_LIST: ListSpec = {
  sorts: {
    time: { sql: 'e.ts' },
    type: { sql: 'e.type' },
    name: { sql: 'e.name', nullable: true },
    page: { sql: 'e.path', nullable: true },
  },
  time: 'e.ts',
  id: 'e.id',
  search: ['e.name', 'e.path', 'e.type'],
}

/** Events in the range, newest first, optionally by name and type. Pings are never stored. */
export function events(
  ctx: Context,
  site: SiteRecord,
  query: StatsQuery,
  options: EventsOptions = {},
): Promise<Page<EventRow>> {
  const filters = filterSql(query.filters)
  let sql = `e.site_id = ? AND e.ts >= ? AND e.ts < ?${filters.sql}`
  const params: unknown[] = [site.id, query.from, query.to, ...filters.params]
  if (options.name) {
    sql += ' AND e.name = ?'
    params.push(options.name)
  }
  if (options.type) {
    sql += ' AND e.type = ?'
    params.push(options.type)
  }
  if (options.visitor) {
    sql += ' AND e.visitor_id = ?'
    params.push(options.visitor)
  }
  return listPage<StoredEvent, EventRow>(
    ctx,
    {
      select: 'e.*',
      from: 'events e JOIN sessions s ON s.site_id = e.site_id AND s.id = e.session_id',
      where: { sql, params },
    },
    EVENT_LIST,
    options,
    toEvent,
    (row) => ({ ts: row.ts, id: row.id }),
  )
}

const PAYMENT_LIST: ListSpec = {
  sorts: {
    time: { sql: 'ts' },
    amount: { sql: 'amount' },
    provider: { sql: 'provider' },
    customer: { sql: 'COALESCE(name, email, customer_id)', nullable: true },
    attribution: { sql: 'matched_by', nullable: true },
  },
  time: 'ts',
  id: 'id',
  search: ['id', 'email', 'name', 'customer_id', 'order_id', 'subscription_id', 'provider'],
}

/** Payments and refunds in the range, newest first unless sorted otherwise. */
export function payments(
  ctx: Context,
  site: SiteRecord,
  query: StatsQuery,
  options: PaymentsOptions = {},
): Promise<Page<Payment>> {
  let sql = 'site_id = ? AND ts >= ? AND ts < ?'
  const params: unknown[] = [site.id, query.from, query.to]
  if (options.kind) {
    sql += ' AND kind = ?'
    params.push(options.kind)
  }
  if (options.provider) {
    sql += ' AND provider = ?'
    params.push(options.provider)
  }
  if (options.attributed !== undefined)
    sql += options.attributed ? ' AND matched_by IS NOT NULL' : ' AND matched_by IS NULL'
  if (options.visitor) {
    sql += ' AND visitor_id = ?'
    params.push(options.visitor)
  }
  return listPage<PaymentRow, Payment>(
    ctx,
    { select: '*', from: 'payments', where: { sql, params } },
    PAYMENT_LIST,
    options,
    toPayment,
    (row) => ({ ts: row.ts, id: row.id }),
  )
}
