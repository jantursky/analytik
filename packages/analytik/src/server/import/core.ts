import { classify } from '../../shared/channels'
import { sha256Hex } from '../../shared/crypto'
import type { ImportEvent, ImportResult, ImportSource, ImportVisit } from '../../shared/import/types'
import { addResults, emptyResult } from '../../shared/import/types'
import { DAY } from '../../shared/time'
import { clip, parseReferrer, stripWww } from '../../shared/url'
import type { Statement } from '../../storage/types'
import type { Context } from '../context'
import { cleanProps } from '../ingest'
import type { SiteRecord } from '../sites'

/** Statements sent to storage at once; D1 refuses large batches, so this stays well under its limit. */
export const BATCH_STATEMENTS = 100
/** Ids per `IN (...)` lookup; D1 allows 100 bound values per statement. */
const LOOKUP = 90

const MAX_PATH = 500

type Hash = (value: string) => Promise<string>

/** A short, stable id: the same source value always gives the same id, so a repeat import finds its rows. */
async function stableId(hash: Hash, source: ImportSource, kind: string, value: string): Promise<string> {
  return `imp:${source}:${kind}${(await hash(`${source}|${kind}|${value}`)).slice(0, 24)}`
}

interface PreparedEvent {
  id: string
  event: ImportEvent
}

interface PreparedVisit {
  visit: ImportVisit
  id: string
  visitorId: string
  startedAt: number
  lastSeenAt: number
  events: PreparedEvent[]
}

async function prepare(
  hash: Hash,
  source: ImportSource,
  visit: ImportVisit,
  cutoff: number,
  result: ImportResult,
): Promise<PreparedVisit | null> {
  const events = visit.events.filter((event) => Number.isFinite(event.ts) && !!event.path)
  const startedAt = visit.startedAt ?? Math.min(...events.map((event) => event.ts))
  if (!Number.isFinite(startedAt)) return null
  if (startedAt < cutoff) {
    result.tooOld.visits++
    result.tooOld.events += events.length
    return null
  }
  const kept = events.filter((event) => event.ts >= cutoff)
  result.tooOld.events += events.length - kept.length

  const seen = new Map<string, number>()
  const prepared: PreparedEvent[] = []
  for (const event of kept) {
    const key = event.id ?? `${visit.id}|${event.ts}|${event.type}|${event.path}|${event.name ?? ''}`
    // Identical events in one visit (a double click) stay apart by occurrence, so a repeat finds the same ids.
    const count = (seen.get(key) ?? 0) + 1
    seen.set(key, count)
    prepared.push({ id: await stableId(hash, source, 'e', `${key}#${count}`), event })
  }
  const lastEvent = Math.max(startedAt, ...kept.map((event) => event.ts))
  return {
    visit,
    id: await stableId(hash, source, 's', visit.id),
    visitorId: await stableId(hash, source, 'v', visit.visitor),
    startedAt,
    lastSeenAt: Math.max(lastEvent, startedAt + Math.max(0, visit.durationMs ?? 0)),
    events: prepared,
  }
}

/** Which of `ids` are stored for the site already. */
async function existingIds(
  ctx: Context,
  table: 'sessions' | 'events',
  siteId: string,
  ids: string[],
): Promise<Set<string>> {
  const found = new Set<string>()
  for (let index = 0; index < ids.length; index += LOOKUP) {
    const part = ids.slice(index, index + LOOKUP)
    const rows = await ctx.storage.query<{ id: string }>(
      `SELECT id FROM ${table} WHERE site_id = ? AND id IN (${part.map(() => '?').join(', ')})`,
      [siteId, ...part],
    )
    for (const row of rows) found.add(row.id)
  }
  return found
}

function sessionStatements(site: SiteRecord, source: ImportSource, prepared: PreparedVisit, events: PreparedEvent[]) {
  const { visit } = prepared
  const pageviews = events.filter((e) => e.event.type === 'pageview')
  const goals = events.length - pageviews.length
  const { referrer, referrerDomain } = parseReferrer(visit.referrer, site.domain)
  const campaign = {
    utmSource: clip(visit.utmSource),
    utmMedium: clip(visit.utmMedium),
  }
  const { source: sourceName, channel } = classify({ referrerDomain, ...campaign })
  const entry = pageviews[0]?.event.path ?? events[0]?.event.path ?? null
  const exit = pageviews.at(-1)?.event.path ?? entry
  return [
    {
      sql: 'INSERT INTO visitors (site_id, id, first_seen) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
      params: [site.id, prepared.visitorId, prepared.startedAt],
    },
    {
      sql: `INSERT INTO sessions (site_id, id, visitor_id, started_at, last_seen_at, duration, pageviews, goals,
              hostname, entry_page, exit_page, referrer, referrer_domain, source, channel, utm_source, utm_medium,
              utm_campaign, utm_term, utm_content, country, region, city, browser, os, device, imported)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT DO NOTHING`,
      params: [
        site.id,
        prepared.id,
        prepared.visitorId,
        prepared.startedAt,
        prepared.lastSeenAt,
        Math.max(0, Math.round(visit.durationMs ?? 0)),
        pageviews.length,
        goals,
        visit.hostname ? stripWww(visit.hostname) : site.domain,
        entry,
        exit,
        referrer,
        referrerDomain,
        sourceName,
        channel,
        campaign.utmSource,
        campaign.utmMedium,
        clip(visit.utmCampaign),
        clip(visit.utmTerm),
        clip(visit.utmContent),
        visit.country ?? null,
        visit.region ?? null,
        visit.city ?? null,
        visit.browser ?? null,
        visit.os ?? null,
        visit.device ?? null,
        source,
      ],
    },
  ] satisfies Statement[]
}

function eventStatement(
  site: SiteRecord,
  source: ImportSource,
  prepared: PreparedVisit,
  item: PreparedEvent,
): Statement {
  const { event } = item
  const props = cleanProps(event.props)
  return {
    sql: `INSERT INTO events (id, site_id, session_id, visitor_id, ts, type, name, path, props, imported)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    params: [
      item.id,
      site.id,
      prepared.id,
      prepared.visitorId,
      event.ts,
      event.type,
      event.type === 'goal' ? clip(event.name, 100) : null,
      event.path.slice(0, MAX_PATH),
      props ? JSON.stringify(props) : null,
      source,
    ],
  }
}

/** Adds events that arrived for a visit stored earlier (a visit split across chunks, or a longer export). */
function topUpStatement(site: SiteRecord, prepared: PreparedVisit, events: PreparedEvent[]): Statement {
  const pageviews = events.filter((e) => e.event.type === 'pageview')
  const lastPage = pageviews.at(-1)?.event.path ?? null
  return {
    sql: `UPDATE sessions SET pageviews = pageviews + ?, goals = goals + ?,
            exit_page = CASE WHEN ? IS NOT NULL AND last_seen_at <= ? THEN ? ELSE exit_page END,
            last_seen_at = CASE WHEN last_seen_at < ? THEN ? ELSE last_seen_at END
          WHERE site_id = ? AND id = ?`,
    params: [
      pageviews.length,
      events.length - pageviews.length,
      lastPage,
      prepared.lastSeenAt,
      lastPage,
      prepared.lastSeenAt,
      prepared.lastSeenAt,
      site.id,
      prepared.id,
    ],
  }
}

async function runInBatches(ctx: Context, statements: Statement[]): Promise<void> {
  for (let index = 0; index < statements.length; index += BATCH_STATEMENTS) {
    await ctx.storage.batch(statements.slice(index, index + BATCH_STATEMENTS))
  }
}

/**
 * Stores visits from another tool for a site. Ids come from the source's own ids, so importing the same
 * visits again (or an overlapping export) adds nothing, and a run that stopped halfway can simply be repeated.
 */
export async function importVisits(
  ctx: Context,
  site: SiteRecord,
  source: ImportSource,
  visits: readonly ImportVisit[],
): Promise<ImportResult> {
  const result = emptyResult()
  const cutoff = site.retentionDays ? ctx.now() - site.retentionDays * DAY : -Infinity
  const prepared: PreparedVisit[] = []
  for (const visit of visits) {
    const item = await prepare(sha256Hex, source, visit, cutoff, result)
    if (item) prepared.push(item)
  }
  if (!prepared.length) return result

  const knownVisits = await existingIds(ctx, 'sessions', site.id, [...new Set(prepared.map((p) => p.id))])
  const knownEvents = await existingIds(
    ctx,
    'events',
    site.id,
    prepared.flatMap((p) => p.events.map((e) => e.id)),
  )

  const statements: Statement[] = []
  const storedEvents = new Set<string>()
  let added: ImportResult = emptyResult()
  const touchedVisits = new Set<string>()
  for (const item of prepared) {
    const fresh = item.events.filter((e) => {
      if (knownEvents.has(e.id) || storedEvents.has(e.id)) return false
      storedEvents.add(e.id)
      return true
    })
    // A visit whose events are all stored already (an export cut at another point) adds no second visit row.
    const visitKnown =
      knownVisits.has(item.id) || touchedVisits.has(item.id) || (fresh.length === 0 && item.events.length > 0)
    const step = emptyResult()
    step.events = fresh.length
    step.existing.events = item.events.length - fresh.length
    if (visitKnown) {
      step.existing.visits = 1
      if (fresh.length) statements.push(topUpStatement(site, item, fresh))
    } else {
      step.visits = 1
      touchedVisits.add(item.id)
      statements.push(...sessionStatements(site, source, item, fresh))
    }
    statements.push(...fresh.map((e) => eventStatement(site, source, item, e)))
    added = addResults(added, step)
  }
  await runInBatches(ctx, statements)
  return addResults(result, added)
}
