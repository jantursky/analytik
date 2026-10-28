import { type ImportEvent, type ImportVisit } from './types'
import { Row, norm } from './row'
import { normalizeBrowser, normalizeCountry, normalizeDevice, normalizeOs, parseTimestamp, pathOf } from './normalize'

/** A row of any Umami table: a CSV record or a JSON object. */
export type UmamiRow = Record<string, unknown>

export type UmamiTable = 'events' | 'sessions' | 'eventData'

export interface UmamiInput {
  /** `website_event` rows; required. */
  events: readonly UmamiRow[]
  /** `session` rows; they carry browser, OS, device and place. Optional when the events already hold them. */
  sessions?: readonly UmamiRow[]
  /** `event_data` rows: the properties of custom events. */
  eventData?: readonly UmamiRow[]
}

export interface SkippedRow {
  table: UmamiTable
  /** The row's position in its file, counting data rows from 1. */
  row: number
  reason: string
}

export interface MappedImport {
  visits: ImportVisit[]
  skipped: SkippedRow[]
}

/** Columns the events file cannot do without. */
export const UMAMI_REQUIRED: readonly string[] = ['created_at', 'session_id', 'url_path']

/** Umami's `event_type` numbers. */
const PAGE_VIEW = 1
const CUSTOM_EVENT = 2

/** A visit ends after this much silence; used only for exports from before Umami recorded `visit_id`. */
const VISIT_GAP = 30 * 60 * 1000

/** Which table a file holds, from its column names; null when it is none of the three. */
export function detectUmamiTable(columns: readonly string[]): UmamiTable | null {
  const names = new Set(columns.map(norm))
  if (names.has('urlpath') || names.has('eventtype')) return 'events'
  if (names.has('datakey')) return 'eventData'
  if (names.has('sessionid') || names.has('id')) {
    if (names.has('browser') || names.has('os') || names.has('country') || names.has('device')) return 'sessions'
  }
  return null
}

function referrerOf(row: Row): string | null {
  const domain = row.text('referrer_domain')
  if (!domain) return null
  const path = row.text('referrer_path') ?? ''
  const query = row.text('referrer_query')
  return `https://${domain}${path.startsWith('/') || !path ? path : `/${path}`}${query ? `?${query.replace(/^\?/, '')}` : ''}`
}

interface Hit {
  row: Row
  sessionId: string
  visitKey: string | null
  ts: number
  eventId: string | null
}

/**
 * Turns Umami's `website_event`, `session` and `event_data` rows into visits. A visit is a `visit_id` (older
 * exports without one are split by session on 30 minutes of silence); Umami's session is the visitor. Pageviews and
 * custom events are kept; link and pixel events and rows without a time, a session or a page are skipped and counted.
 */
export function mapUmami(input: UmamiInput): MappedImport {
  const skipped: SkippedRow[] = []
  const skip = (table: UmamiTable, row: number, reason: string): void => {
    skipped.push({ table, row, reason })
  }

  const sessions = new Map<string, Row>()
  input.sessions?.forEach((raw) => {
    const row = new Row(raw)
    const id = row.text('session_id') ?? row.text('id')
    if (id) sessions.set(id, row)
  })

  const props = new Map<string, Record<string, string | number | boolean | null>>()
  input.eventData?.forEach((raw, index) => {
    const row = new Row(raw)
    const eventId = row.text('website_event_id')
    const key = row.text('data_key')
    if (!eventId || !key) {
      skip('eventData', index + 1, 'missing website_event_id or data_key')
      return
    }
    const number = row.text('number_value')
    const value =
      row.text('string_value') ??
      (number !== null && Number.isFinite(Number(number)) ? Number(number) : row.text('date_value'))
    const own = props.get(eventId) ?? {}
    own[key] = value
    props.set(eventId, own)
  })

  const hits: Hit[] = []
  const events = new Map<Hit, ImportEvent>()
  input.events.forEach((raw, index) => {
    const row = new Row(raw)
    const number = index + 1
    const ts = parseTimestamp(row.text('created_at'))
    if (ts === null) {
      skip('events', number, 'created_at is missing or not a date')
      return
    }
    const sessionId = row.text('session_id')
    if (!sessionId) {
      skip('events', number, 'session_id is missing')
      return
    }
    const type = Number(row.text('event_type') ?? PAGE_VIEW)
    if (type !== PAGE_VIEW && type !== CUSTOM_EVENT) {
      skip('events', number, `event_type ${type} is not supported`)
      return
    }
    const path = pathOf(row.text('url_path'))
    if (!path) {
      skip('events', number, 'url_path is missing')
      return
    }
    const name = row.text('event_name')
    if (type === CUSTOM_EVENT && !name) {
      skip('events', number, 'a custom event has no event_name')
      return
    }
    const hit: Hit = { row, sessionId, visitKey: row.text('visit_id'), ts, eventId: row.text('event_id') }
    hits.push(hit)
    const eventProps = hit.eventId ? props.get(hit.eventId) : undefined
    events.set(hit, {
      ...(hit.eventId && { id: hit.eventId }),
      ts,
      type: type === CUSTOM_EVENT ? 'goal' : 'pageview',
      name: type === CUSTOM_EVENT ? name : null,
      path,
      ...(type === CUSTOM_EVENT && eventProps && { props: eventProps }),
    })
  })

  // Group into visits: by visit_id when the export has it, otherwise by session and 30-minute gaps.
  hits.sort((a, b) => a.ts - b.ts)
  const groups = new Map<string, Hit[]>()
  const lastSeen = new Map<string, { key: string; ts: number }>()
  for (const hit of hits) {
    let key: string
    if (hit.visitKey) {
      key = hit.visitKey
    } else {
      const last = lastSeen.get(hit.sessionId)
      key = last && hit.ts - last.ts <= VISIT_GAP ? last.key : `${hit.sessionId}:${hit.ts}`
      lastSeen.set(hit.sessionId, { key, ts: hit.ts })
    }
    const group = groups.get(key)
    if (group) group.push(hit)
    else groups.set(key, [hit])
  }

  const visits: ImportVisit[] = []
  for (const [key, group] of groups) {
    const first = group[0]
    const last = group.at(-1)
    if (!first || !last) continue
    const session = sessions.get(first.sessionId)
    // The first event that has a value for a field supplies it, whether it lives on the session or the event.
    const pick = (name: string): string | null =>
      session?.text(name) ?? group.map((hit) => hit.row.text(name)).find((value) => value !== null) ?? null
    const fromEvents = (name: string): string | null =>
      group.map((hit) => hit.row.text(name)).find((v) => v !== null) ?? null
    visits.push({
      id: key,
      visitor: first.sessionId,
      startedAt: first.ts,
      // Umami's own visit length: first to last event. A visit with one event has no known length.
      durationMs: last.ts > first.ts ? last.ts - first.ts : null,
      hostname: fromEvents('hostname'),
      referrer: referrerOf(first.row),
      utmSource: fromEvents('utm_source'),
      utmMedium: fromEvents('utm_medium'),
      utmCampaign: fromEvents('utm_campaign'),
      utmTerm: fromEvents('utm_term'),
      utmContent: fromEvents('utm_content'),
      country: normalizeCountry(pick('country')),
      region: pick('region'),
      city: pick('city'),
      browser: normalizeBrowser(pick('browser')),
      os: normalizeOs(pick('os')),
      device: normalizeDevice(pick('device')),
      events: group.map((hit) => events.get(hit)).filter((event): event is ImportEvent => !!event),
    })
  }
  return { visits, skipped }
}
