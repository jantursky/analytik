import { normalizeBrowser, normalizeCountry, normalizeDevice, normalizeOs, parseTimestamp, pathOf } from './normalize'
import { Row, type SourceRow } from './row'
import type { ImportEvent, ImportVisit } from './types'

export interface SimpleAnalyticsMapped {
  visits: ImportVisit[]
  skipped: { row: number; reason: string }[]
}

/** Columns the export cannot do without. */
export const SIMPLE_ANALYTICS_REQUIRED: readonly string[] = ['added_iso', 'path']

/** A visit ends after this much silence, the same rule the tracker uses. */
const VISIT_GAP = 30 * 60 * 1000

const yes = (value: string | null): boolean => value !== null && /^(true|t|1|yes)$/i.test(value)

/** The columns that, together, stand in for a person: Simple Analytics keeps no visitor or visit id. */
const FINGERPRINT = [
  'user_agent',
  'browser_name',
  'browser_version',
  'os_name',
  'os_version',
  'device_type',
  'country_code',
  'screen_width',
  'screen_height',
  'lang_language',
  'lang_region',
] as const

function referrerOf(row: Row): string | null {
  const document = row.text('document_referrer')
  if (document) return document
  const host = row.text('referrer_hostname')
  if (!host) return null
  const path = row.text('referrer_path') ?? ''
  return `https://${host}${path && !path.startsWith('/') ? `/${path}` : path}`
}

interface Hit {
  row: Row
  ts: number
  path: string
  name: string | null
  group: string
}

/**
 * Turns the raw export of Simple Analytics (page views and events, `type=all`) into visits. Its `session_id` is a
 * page-load id, not a visit, so a visit is rebuilt from rows that share a fingerprint (browser, system, device,
 * country, screen, language) with no more than 30 minutes of silence between them. The fingerprint is also the visitor.
 * Rows from robots and rows without a time or a path are skipped and counted.
 */
export function mapSimpleAnalytics(rows: readonly SourceRow[]): SimpleAnalyticsMapped {
  const skipped: SimpleAnalyticsMapped['skipped'] = []
  const hits: Hit[] = []
  rows.forEach((raw, index) => {
    const row = new Row(raw)
    const number = index + 1
    if (yes(row.text('is_robot'))) {
      skipped.push({ row: number, reason: 'made by a robot' })
      return
    }
    const ts = parseTimestamp(row.text('added_iso') ?? row.text('added_unix'))
    if (ts === null) {
      skipped.push({ row: number, reason: 'added_iso is missing or not a date' })
      return
    }
    const path = pathOf(row.text('path') ?? row.text('path_and_query') ?? row.text('url'))
    if (!path) {
      skipped.push({ row: number, reason: 'path is missing' })
      return
    }
    const datapoint = row.text('datapoint')
    const name = datapoint && datapoint.toLowerCase() !== 'pageview' ? datapoint : null
    hits.push({ row, ts, path, name, group: FINGERPRINT.map((column) => row.text(column) ?? '').join('|') })
  })

  hits.sort((a, b) => a.ts - b.ts)
  const open = new Map<string, { hits: Hit[]; last: number }>()
  const visitsOfGroup = new Map<string, Hit[][]>()
  for (const hit of hits) {
    const current = open.get(hit.group)
    if (current && hit.ts - current.last <= VISIT_GAP) {
      current.hits.push(hit)
      current.last = hit.ts
      continue
    }
    const fresh = { hits: [hit], last: hit.ts }
    open.set(hit.group, fresh)
    const list = visitsOfGroup.get(hit.group) ?? []
    list.push(fresh.hits)
    visitsOfGroup.set(hit.group, list)
  }

  const visits: ImportVisit[] = []
  for (const [group, list] of visitsOfGroup) {
    for (const visitHits of list) {
      const first = visitHits[0]
      const last = visitHits.at(-1)
      if (!first || !last) continue
      const any = (name: string): string | null => visitHits.map((hit) => hit.row.text(name)).find((v) => v) ?? null
      const seconds = visitHits.map((hit) => Number(hit.row.text('duration_seconds') ?? NaN)).filter(Number.isFinite)
      const device = normalizeDevice(first.row.text('device_type'))
      const events: ImportEvent[] = visitHits.map((hit) => ({
        // Not tied to the visit, so an overlapping export that cuts a visit elsewhere still finds these rows again.
        id: `${group}|${hit.ts}|${hit.name ?? ''}|${hit.path}`,
        ts: hit.ts,
        type: hit.name ? 'goal' : 'pageview',
        name: hit.name,
        path: hit.path,
      }))
      visits.push({
        id: `${group}|${first.ts}`,
        visitor: group,
        startedAt: first.ts,
        // Time on page when the export has it, otherwise first to last row; a single row has no known length.
        durationMs: seconds.length
          ? Math.round(seconds.reduce((sum, value) => sum + value, 0) * 1000)
          : last.ts > first.ts
            ? last.ts - first.ts
            : null,
        hostname: any('hostname'),
        referrer: referrerOf(first.row),
        utmSource: any('utm_source'),
        utmMedium: any('utm_medium'),
        utmCampaign: any('utm_campaign'),
        utmTerm: any('utm_term'),
        utmContent: any('utm_content'),
        country: normalizeCountry(first.row.text('country_code')),
        browser: normalizeBrowser(first.row.text('browser_name')),
        os: normalizeOs(first.row.text('os_name')),
        device: device === null && first.row.text('device_type')?.toLowerCase() === 'tv' ? 'Desktop' : device,
        events,
      })
    }
  }
  visits.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
  return { visits, skipped }
}
