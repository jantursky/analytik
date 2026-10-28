import { normalizeBrowser, normalizeCountry, normalizeDevice, normalizeOs, parseTimestamp, pathOf } from './normalize'
import type { SourceRow } from './row'
import type { ImportEvent, ImportVisit } from './types'

export interface PostHogMapped {
  visits: ImportVisit[]
  skipped: { row: number; reason: string }[]
}

/** Fields an exported PostHog event cannot do without. */
export const POSTHOG_REQUIRED: readonly string[] = ['event', 'distinct_id', 'timestamp']

/** A visit ends after this much silence; used for events that carry no `$session_id`. */
const VISIT_GAP = 30 * 60 * 1000

type Props = Record<string, unknown>

/** `properties` is an object from the API and a JSON string in CSV and batch exports. */
function propsOf(row: SourceRow): Props {
  const value = row.properties
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown
      return typeof parsed === 'object' && parsed !== null ? (parsed as Props) : {}
    } catch {
      return {}
    }
  }
  return typeof value === 'object' && value !== null ? (value as Props) : {}
}

const text = (value: unknown): string | null => {
  const out = typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : ''
  return out === '' || out === '$direct' ? null : out
}

interface Hit {
  row: SourceRow
  props: Props
  ts: number
  who: string
  session: string | null
  event: ImportEvent
}

/**
 * Turns PostHog events (the events API, or a batch export) into visits. A visit is a `$session_id`, or, for events
 * without one, a `distinct_id` with no more than 30 minutes of silence; the distinct id is the visitor. `$pageview` is
 * a pageview and events you named yourself are goals. PostHog's own `$` events (autocapture, page leave, identify,
 * feature flags) are left out without being counted, and so are events with no page.
 */
export function mapPostHog(rows: readonly SourceRow[]): PostHogMapped {
  const skipped: PostHogMapped['skipped'] = []
  const hits: Hit[] = []
  rows.forEach((row, index) => {
    const number = index + 1
    const name = text(row.event)
    const who = text(row.distinct_id)
    const ts = parseTimestamp(row.timestamp)
    if (!name || !who || ts === null) {
      skipped.push({ row: number, reason: 'event, distinct_id or timestamp is missing' })
      return
    }
    if (name.startsWith('$') && name !== '$pageview') return
    const props = propsOf(row)
    const path = pathOf(text(props.$pathname) ?? text(props.$current_url))
    if (!path) {
      skipped.push({ row: number, reason: 'the event has no page' })
      return
    }
    const event: ImportEvent =
      name === '$pageview' ? { ts, type: 'pageview', name: null, path } : { ts, type: 'goal', name, path }
    hits.push({ row, props, ts, who, session: text(props.$session_id), event })
  })

  hits.sort((a, b) => a.ts - b.ts)
  const groups = new Map<string, Hit[]>()
  const lastSeen = new Map<string, { key: string; ts: number }>()
  for (const hit of hits) {
    let key: string
    if (hit.session) {
      key = hit.session
    } else {
      const last = lastSeen.get(hit.who)
      key = last && hit.ts - last.ts <= VISIT_GAP ? last.key : `${hit.who}:${hit.ts}`
      lastSeen.set(hit.who, { key, ts: hit.ts })
    }
    const group = groups.get(key)
    if (group) group.push(hit)
    else groups.set(key, [hit])
  }

  const visits: ImportVisit[] = []
  for (const [id, group] of groups) {
    const first = group[0]
    const last = group.at(-1)
    if (!first || !last) continue
    const pick = (name: string): string | null => group.map((hit) => text(hit.props[name])).find((v) => v) ?? null
    visits.push({
      id,
      visitor: first.who,
      startedAt: first.ts,
      durationMs: last.ts > first.ts ? last.ts - first.ts : null,
      hostname: pick('$host'),
      referrer: text(first.props.$referrer) ?? text(first.props.$initial_referrer),
      utmSource: pick('utm_source'),
      utmMedium: pick('utm_medium'),
      utmCampaign: pick('utm_campaign'),
      utmTerm: pick('utm_term'),
      utmContent: pick('utm_content'),
      country: normalizeCountry(pick('$geoip_country_code')),
      region: pick('$geoip_subdivision_1_name'),
      city: pick('$geoip_city_name'),
      browser: normalizeBrowser(pick('$browser')),
      os: normalizeOs(pick('$os')),
      device: normalizeDevice(pick('$device_type')),
      events: group.map((hit) => hit.event),
    })
  }
  return { visits, skipped }
}
