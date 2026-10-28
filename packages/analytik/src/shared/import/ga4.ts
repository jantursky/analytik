import { normalizeBrowser, normalizeCountry, normalizeDevice, normalizeOs, parseTimestamp, pathOf } from './normalize'
import type { SourceRow } from './row'
import type { ImportEvent, ImportVisit } from './types'

export interface Ga4Mapped {
  visits: ImportVisit[]
  skipped: { row: number; reason: string }[]
}

/** Fields an `events_*` row of the GA4 BigQuery export cannot do without. */
export const GA4_REQUIRED: readonly string[] = ['event_timestamp', 'event_name', 'user_pseudo_id']

/** Events GA4 records on its own that say nothing a page view does not. */
const IGNORED = new Set(['session_start', 'first_visit', 'user_engagement', 'scroll'])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown): string | null => {
  if (typeof value === 'string') return value.trim() === '' ? null : value.trim()
  return typeof value === 'number' ? String(value) : null
}

const at = (row: SourceRow, ...path: string[]): unknown =>
  path.reduce<unknown>((value, key) => (isRecord(value) ? value[key] : undefined), row)

/** `event_params` is a list of `{ key, value: { string_value | int_value | double_value | float_value } }`. */
function paramsOf(row: SourceRow): Map<string, string> {
  const params = new Map<string, string>()
  const list = row.event_params
  if (!Array.isArray(list)) return params
  for (const item of list) {
    if (!isRecord(item) || typeof item.key !== 'string' || !isRecord(item.value)) continue
    const value = text(
      item.value.string_value ?? item.value.int_value ?? item.value.double_value ?? item.value.float_value,
    )
    if (value !== null) params.set(item.key, value)
  }
  return params
}

function hostOf(url: string | null): string | null {
  if (!url || !/^https?:\/\//i.test(url)) return null
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

interface Hit {
  row: SourceRow
  params: Map<string, string>
  ts: number
  event: ImportEvent
}

/**
 * Turns the events of the GA4 BigQuery export (JSON) into visits. A visit is a `user_pseudo_id` with a
 * `ga_session_id`, and the user is the visitor. `page_view` is a pageview and every other event except GA4's own
 * housekeeping events is a goal. Rows without a time, a user or a page are skipped and counted. The campaign comes
 * from the session's own event parameters, because the export's `traffic_source` describes the user's first visit.
 */
export function mapGa4(rows: readonly SourceRow[]): Ga4Mapped {
  const skipped: Ga4Mapped['skipped'] = []
  const groups = new Map<string, Hit[]>()
  rows.forEach((row, index) => {
    const number = index + 1
    const name = text(row.event_name)
    const user = text(row.user_pseudo_id)
    const micros = Number(text(row.event_timestamp))
    if (!name || !user || !Number.isFinite(micros)) {
      skipped.push({ row: number, reason: 'event_name, user_pseudo_id or event_timestamp is missing' })
      return
    }
    if (IGNORED.has(name)) return
    const params = paramsOf(row)
    const path = pathOf(params.get('page_location') ?? null)
    if (!path) {
      skipped.push({ row: number, reason: 'the event has no page_location' })
      return
    }
    const ts = parseTimestamp(Math.round(micros / 1000))
    if (ts === null) {
      skipped.push({ row: number, reason: 'event_timestamp is not a time' })
      return
    }
    const event: ImportEvent =
      name === 'page_view' ? { ts, type: 'pageview', name: null, path } : { ts, type: 'goal', name, path }
    const key = `${user}:${params.get('ga_session_id') ?? Math.floor(ts / 86_400_000)}`
    const hit = { row, params, ts, event }
    const group = groups.get(key)
    if (group) group.push(hit)
    else groups.set(key, [hit])
  })

  const visits: ImportVisit[] = []
  for (const [id, group] of groups) {
    group.sort((a, b) => a.ts - b.ts)
    const first = group[0]
    if (!first) continue
    const first_ = (name: string): string | null => group.map((hit) => hit.params.get(name)).find((v) => v) ?? null
    const manual = (field: string): string | null => text(at(first.row, 'collected_traffic_source', field))
    const engaged = group.reduce((sum, hit) => sum + (Number(hit.params.get('engagement_time_msec')) || 0), 0)
    const referrer = group.map((hit) => hit.params.get('page_referrer')).find((value) => value)
    const location = group.map((hit) => hit.params.get('page_location')).find((value) => value) ?? null
    visits.push({
      id,
      visitor: text(first.row.user_pseudo_id) ?? id,
      startedAt: first.ts,
      durationMs: engaged > 0 ? engaged : null,
      hostname: hostOf(location),
      referrer: referrer ?? null,
      utmSource: first_('source') ?? manual('manual_source'),
      utmMedium: first_('medium') ?? manual('manual_medium'),
      utmCampaign: first_('campaign') ?? manual('manual_campaign_name'),
      utmTerm: manual('manual_term'),
      utmContent: manual('manual_content'),
      country: normalizeCountry(text(at(first.row, 'geo', 'country'))),
      region: text(at(first.row, 'geo', 'region')),
      city: text(at(first.row, 'geo', 'city')),
      browser: normalizeBrowser(
        text(at(first.row, 'device', 'web_info', 'browser')) ?? text(at(first.row, 'device', 'browser')),
      ),
      os: normalizeOs(text(at(first.row, 'device', 'operating_system'))),
      device: normalizeDevice(text(at(first.row, 'device', 'category'))),
      events: group.map((hit) => hit.event),
    })
  }
  return { visits, skipped }
}
