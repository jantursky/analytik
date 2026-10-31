import { classify } from '../shared/channels'
import { ipMatcher } from '../shared/cidr'
import { isId, isSiteId, randomId } from '../shared/ids'
import { DAY, HOUR, MINUTE } from '../shared/time'
import type { EventType, PrivacyMode, Props } from '../shared/types'
import { isBot, parseUserAgent } from '../shared/ua'
import { clip, extractCampaign, hostBelongsTo, isLocalhost, pagePath, parseReferrer, stripWww } from '../shared/url'
import type { Statement } from '../storage/types'
import type { Context } from './context'
import { claimStatements } from './attribution'
import { recordPayment } from './payments'
import { effectiveMode, strictVisitorId } from './privacy'
import { purgeBefore } from './stats/purge'
import { getSite, type SiteRecord } from './sites'
import type { Geo, IngestInput, IngestResult } from './types'

const TYPES: ReadonlySet<EventType> = new Set(['pageview', 'goal', 'outbound', 'ping', 'identify', 'revenue'])
const MODES: ReadonlySet<PrivacyMode> = new Set(['strict', 'enriched', 'persistent'])
export const SESSION_WINDOW = 30 * MINUTE
// One update can carry a whole half-hour visit when the page sends its time only on leaving.
const MAX_PING = 30 * MINUTE

interface Payload {
  w: string
  t: EventType
  url: URL
  r: string | undefined
  vid: unknown
  sid: unknown
  sw: number | undefined
  n: unknown
  p: unknown
  d: unknown
  a: unknown
  c: unknown
  o: unknown
  m: PrivacyMode | undefined
}

function parsePayload(raw: unknown): Payload | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'payload must be an object'
  const body = raw as Record<string, unknown>
  if (!isSiteId(body.w)) return 'w (site id) is required'
  if (!TYPES.has(body.t as EventType)) return 't (event type) is invalid'
  if (typeof body.u !== 'string' || body.u.length > 2000) return 'u (page url) is required'
  let url: URL
  try {
    url = new URL(body.u)
  } catch {
    return 'u (page url) is invalid'
  }
  if (!/^https?:$/.test(url.protocol)) return 'u (page url) must be http(s)'
  return {
    w: body.w,
    t: body.t as EventType,
    url,
    r: typeof body.r === 'string' ? body.r.slice(0, 2000) : undefined,
    vid: body.vid,
    sid: body.sid,
    sw: typeof body.sw === 'number' && Number.isFinite(body.sw) ? body.sw : undefined,
    n: body.n,
    p: body.p,
    d: body.d,
    a: body.a,
    c: body.c,
    o: body.o,
    m: MODES.has(body.m as PrivacyMode) ? (body.m as PrivacyMode) : undefined,
  }
}

/** Keeps flat props only: up to 30 keys, scalar values, strings clipped. */
export function cleanProps(raw: unknown): Props | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const props: Props = {}
  let count = 0
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (count >= 30 || !key || key.length > 64) continue
    if (typeof value === 'string') props[key] = value.slice(0, 500)
    else if ((typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean' || value === null) {
      props[key] = value
    } else continue
    count++
  }
  return count > 0 ? props : null
}

function originAllowed(ctx: Context, site: SiteRecord, hostname: string): boolean {
  if (ctx.allowedOrigins === 'any') return true
  if (hostBelongsTo(hostname, site.domain)) return true
  if (site.allowLocalhost && isLocalhost(hostname)) return true
  return Array.isArray(ctx.allowedOrigins) && ctx.allowedOrigins.some((allowed) => hostBelongsTo(hostname, allowed))
}

function hostnameOf(origin: string): string | null {
  try {
    return new URL(origin).hostname
  } catch {
    return null
  }
}

/** Minor units from a major-unit amount (29.99 USD → 2999), using the currency's decimals. */
export function toMinorUnits(amount: number, currency: string): number {
  let decimals = 2
  try {
    decimals = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    // Unknown currency code: assume cents.
  }
  return Math.round(amount * 10 ** decimals)
}

interface Visit {
  visitorId: string
  sessionId: string
  /** The session row exists already. */
  known: boolean
}

/** Finds or opens the visit an event belongs to. */
async function resolveVisit(
  ctx: Context,
  site: SiteRecord,
  mode: PrivacyMode,
  payload: Payload,
  input: IngestInput,
  now: number,
): Promise<Visit | string> {
  if (mode === 'persistent') {
    if (!isId(payload.vid) || !isId(payload.sid)) return 'vid and sid are required in persistent mode'
    const [row] = await ctx.storage.query('SELECT 1 AS found FROM sessions WHERE site_id = ? AND id = ?', [
      site.id,
      payload.sid,
    ])
    return { visitorId: payload.vid, sessionId: payload.sid, known: !!row }
  }
  const visitorId = await strictVisitorId(ctx, site.id, input.ip ?? '', input.userAgent ?? '', now)
  if (mode === 'enriched' && isId(payload.sid)) {
    const [row] = await ctx.storage.query('SELECT 1 AS found FROM sessions WHERE site_id = ? AND id = ?', [
      site.id,
      payload.sid,
    ])
    return { visitorId, sessionId: payload.sid, known: !!row }
  }
  const [recent] = await ctx.storage.query<{ id: string }>(
    `SELECT id FROM sessions WHERE site_id = ? AND visitor_id = ? AND last_seen_at > ?
     ORDER BY last_seen_at DESC LIMIT 1`,
    [site.id, visitorId, now - SESSION_WINDOW],
  )
  return recent
    ? { visitorId, sessionId: recent.id, known: true }
    : { visitorId, sessionId: randomId(20, ctx.random), known: false }
}

/** What one hit changes on its session's counters. */
export interface SessionChange {
  pageviews?: number
  goals?: number
  /** Engaged milliseconds to add. */
  duration?: number
  exitPage?: string
  /** Moves `last_seen_at` forward. */
  seenAt?: number
}

const CHANGE_COLUMNS = {
  pageviews: 'pageviews = pageviews + ?',
  goals: 'goals = goals + ?',
  duration: 'duration = duration + ?',
  exitPage: 'exit_page = ?',
  seenAt: 'last_seen_at = ?',
} as const satisfies Record<keyof SessionChange, string>

/** One UPDATE for every counter a hit moves on its session. */
export function sessionUpdate(siteId: string, sessionId: string, change: SessionChange): Statement {
  const keys = (Object.keys(CHANGE_COLUMNS) as (keyof SessionChange)[]).filter((key) => change[key] !== undefined)
  return {
    sql: `UPDATE sessions SET ${keys.map((key) => CHANGE_COLUMNS[key]).join(', ')} WHERE site_id = ? AND id = ?`,
    params: [...keys.map((key) => change[key]), siteId, sessionId],
  }
}

function newSessionStatements(
  site: SiteRecord,
  visit: Visit,
  payload: Payload,
  path: string,
  input: IngestInput,
  now: number,
): Statement[] {
  const { referrer, referrerDomain } = parseReferrer(payload.r, site.domain)
  const campaign = extractCampaign(payload.url)
  const { source, channel } = classify({
    referrerDomain,
    utmSource: campaign.utmSource,
    utmMedium: campaign.utmMedium,
    ref: campaign.ref,
  })
  const { browser, os, device } = parseUserAgent(input.userAgent ?? '', payload.sw)
  const geo: Geo = input.geo ?? { country: null, region: null, city: null, lat: null, lon: null }
  return [
    {
      sql: 'INSERT INTO visitors (site_id, id, first_seen) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
      params: [site.id, visit.visitorId, now],
    },
    {
      sql: `INSERT INTO sessions (site_id, id, visitor_id, started_at, last_seen_at, hostname, entry_page, exit_page,
              referrer, referrer_domain, source, channel, utm_source, utm_medium, utm_campaign, utm_term, utm_content,
              ref, country, region, city, browser, os, device, lat, lon)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      params: [
        site.id,
        visit.sessionId,
        visit.visitorId,
        now,
        now,
        stripWww(payload.url.hostname),
        path,
        path,
        referrer,
        referrerDomain,
        source,
        channel,
        campaign.utmSource,
        campaign.utmMedium,
        campaign.utmCampaign,
        campaign.utmTerm,
        campaign.utmContent,
        campaign.ref,
        geo.country,
        geo.region,
        geo.city,
        browser,
        os,
        device,
        geo.lat,
        geo.lon,
      ],
    },
  ]
}

function eventStatement(
  ctx: Context,
  site: SiteRecord,
  visit: Visit,
  now: number,
  type: EventType,
  name: string | null,
  path: string,
  props: Props | null,
): Statement {
  return {
    sql: `INSERT INTO events (id, site_id, session_id, visitor_id, ts, type, name, path, props)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      randomId(20, ctx.random),
      site.id,
      visit.sessionId,
      visit.visitorId,
      now,
      type,
      name,
      path,
      props ? JSON.stringify(props) : null,
    ],
  }
}

/** Enforces the site's retention setting, at most once an hour per instance. */
async function enforceRetention(ctx: Context, site: SiteRecord, now: number): Promise<void> {
  if (!site.retentionDays || now - (ctx.retentionRuns.get(site.id) ?? 0) < HOUR) return
  ctx.retentionRuns.set(site.id, now)
  await purgeBefore(ctx, site.id, now - site.retentionDays * DAY)
}

// Parsed lists by their text: an event costs one lookup, not a parse of up to 100 entries.
const matchers = new Map<string, (ip: string) => boolean>()

function ignoresIp(entries: readonly string[], ip: string): boolean {
  if (entries.length === 0) return false
  const key = entries.join(',')
  let match = matchers.get(key)
  if (!match) {
    if (matchers.size >= 200) matchers.clear()
    match = ipMatcher(entries)
    matchers.set(key, match)
  }
  return match(ip)
}

/** Validates and stores one tracker event. Shared by `POST /event` and `analytik.ingest()`. */
export async function ingest(ctx: Context, input: IngestInput): Promise<IngestResult> {
  const payload = parsePayload(input.payload)
  if (typeof payload === 'string') return { status: 400, error: payload }
  if (isBot(input.userAgent)) return { status: 202, visitorId: null, sessionId: null, filtered: 'bot' }

  const site = await getSite(ctx, payload.w)
  if (!site) return { status: 404, error: 'site not found' }
  const originHost = input.origin ? hostnameOf(input.origin) : null
  if (
    !originAllowed(ctx, site, payload.url.hostname) ||
    (input.origin && !originAllowed(ctx, site, originHost ?? ''))
  ) {
    return { status: 403, error: 'origin not allowed for this site' }
  }
  if (input.ip && ignoresIp(site.ignoredIps, input.ip)) {
    return { status: 202, visitorId: null, sessionId: null, filtered: 'ignored-ip' }
  }
  if (site.ignoreAdmins && input.admin) return { status: 202, visitorId: null, sessionId: null, filtered: 'admin' }
  if (site.paused) return { status: 202, visitorId: null, sessionId: null, filtered: 'paused' }

  const now = ctx.now()
  const doNotTrack = ctx.respectDoNotTrack && input.doNotTrack === true
  const mode = effectiveMode(site.privacyMode, payload.m, doNotTrack)
  const visit = await resolveVisit(ctx, site, mode, payload, input, now)
  if (typeof visit === 'string') return { status: 400, error: visit }
  await enforceRetention(ctx, site, now)

  const accepted: IngestResult = { status: 202, visitorId: visit.visitorId, sessionId: visit.sessionId }
  const path = pagePath(payload.url, ctx.keepQuery)

  if (payload.t === 'ping') {
    const ms = Math.max(0, Math.min(MAX_PING, Math.round(Number(payload.d) || 0)))
    if (visit.known) {
      const update = sessionUpdate(site.id, visit.sessionId, { duration: ms, seenAt: now })
      await ctx.storage.run(update.sql, update.params)
    }
    return accepted
  }

  if (payload.t === 'identify') {
    // Strict mode has no consent to tie a person to a visitor id.
    if (mode === 'strict') return accepted
    const props = cleanProps(payload.p) ?? {}
    await ctx.storage.batch([
      {
        sql: 'INSERT INTO visitors (site_id, id, first_seen) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
        params: [site.id, visit.visitorId, now],
      },
      {
        sql: `UPDATE visitors SET user_id = COALESCE(?, user_id), email = COALESCE(?, email), name = COALESCE(?, name)
              WHERE site_id = ? AND id = ?`,
        params: [
          clip(props.userId ?? props.user_id, 128),
          clip(props.email, 200)?.toLowerCase() ?? null,
          clip(props.name, 128),
          site.id,
          visit.visitorId,
        ],
      },
    ])
    return accepted
  }

  const statements: Statement[] = visit.known ? [] : newSessionStatements(site, visit, payload, path, input, now)
  const touch = sessionUpdate(site.id, visit.sessionId, { seenAt: now })

  switch (payload.t) {
    case 'pageview':
      statements.push(
        sessionUpdate(site.id, visit.sessionId, { pageviews: 1, exitPage: path, seenAt: now }),
        eventStatement(ctx, site, visit, now, 'pageview', null, path, null),
        ...claimStatements(site.id, visit.visitorId, payload.url, now),
      )
      break
    case 'goal': {
      const name = clip(payload.n, 100)
      if (!name) return { status: 400, error: 'n (goal name) is required' }
      statements.push(
        sessionUpdate(site.id, visit.sessionId, { goals: 1, seenAt: now }),
        eventStatement(ctx, site, visit, now, 'goal', name, path, cleanProps(payload.p)),
      )
      break
    }
    case 'outbound': {
      const target = clip(payload.n, 500)
      if (!target) return { status: 400, error: 'n (link target) is required' }
      statements.push(touch, eventStatement(ctx, site, visit, now, 'outbound', target, path, null))
      break
    }
    case 'revenue': {
      if (typeof payload.a !== 'number' || !Number.isFinite(payload.a) || payload.a <= 0) {
        return { status: 400, error: 'a (amount) must be a positive number' }
      }
      const currency =
        typeof payload.c === 'string' && /^[a-z]{3}$/i.test(payload.c) ? payload.c.toUpperCase() : site.currency
      const props = cleanProps(payload.p)
      statements.push(touch, eventStatement(ctx, site, visit, now, 'revenue', clip(payload.n, 100), path, props))
      await ctx.storage.batch(statements)
      const orderId = clip(payload.o, 190)
      await recordPayment(
        ctx,
        site,
        {
          // Unverified, so kept apart from the ids payment providers use.
          id: `client:${orderId ?? randomId(20, ctx.random)}`,
          ...(orderId && { orderId }),
          amount: toMinorUnits(payload.a, currency),
          currency,
          visitorId: visit.visitorId,
          sessionId: visit.sessionId,
          ts: now,
        },
        'client',
      )
      return accepted
    }
  }
  await ctx.storage.batch(statements)
  return accepted
}
