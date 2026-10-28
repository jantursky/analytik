import { normalizeBrowser, normalizeCountry, normalizeOs, parseTimestamp, pathOf } from './normalize'
import { Row, type SourceRow } from './row'
import type { ImportEvent, ImportVisit } from './types'

export interface GoatCounterMapped {
  visits: ImportVisit[]
  skipped: { row: number; reason: string }[]
}

/** Columns the export cannot do without. */
export const GOATCOUNTER_REQUIRED: readonly string[] = ['path', 'date']

/** A visit ends after this much silence, the same rule the tracker uses. */
const VISIT_GAP = 30 * 60 * 1000

/** The export writes its version into the first column name (`2Path`); drops it. */
export const unversioned = (row: SourceRow): SourceRow =>
  Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/^\d+(?=\D)/, ''), value]))

const yes = (value: string | null): boolean => value !== null && /^(true|t|1|yes)$/i.test(value)

/** GoatCounter writes "Chrome 141" and "Windows 10"; the tracker stores the name alone. */
const withoutVersion = (value: string | null): string | null => value?.replace(/\s+v?\d[\d.]*$/, '') ?? null

/** GoatCounter keeps the screen as `width,height,scale` and no device type. */
function deviceOf(screen: string | null): 'Desktop' | 'Mobile' | 'Tablet' | null {
  const width = Number(screen?.split(',')[0])
  if (!Number.isFinite(width) || width <= 0) return null
  return width < 768 ? 'Mobile' : width < 1024 ? 'Tablet' : 'Desktop'
}

/** The `Referrer scheme` column says what the referrer is: h web page, g generated (a name), c campaign, o other. */
function referrerOf(row: Row): { referrer: string | null; campaign: string | null } {
  const value = row.text('referrer')
  if (!value) return { referrer: null, campaign: null }
  const scheme = row.text('referrerscheme')
  if (scheme === 'c') return { referrer: null, campaign: value }
  return { referrer: scheme === 'h' && !/^https?:\/\//i.test(value) ? `https://${value}` : value, campaign: null }
}

interface Hit {
  row: Row
  ts: number
  path: string
  goal: boolean
  session: string
}

/**
 * Turns the hits CSV of GoatCounter (Settings, Export) into visits. Its `Session` column groups the hits of one
 * person, and a visit ends after 30 minutes of silence; the session is also the visitor. Hits from robots and rows
 * without a time or a path are skipped and counted.
 */
export function mapGoatCounter(rows: readonly SourceRow[]): GoatCounterMapped {
  const skipped: GoatCounterMapped['skipped'] = []
  const hits: Hit[] = []
  rows.forEach((raw, index) => {
    const row = new Row(unversioned(raw))
    const number = index + 1
    if (Number(row.text('bot') ?? 0) > 0) {
      skipped.push({ row: number, reason: 'a robot' })
      return
    }
    const ts = parseTimestamp(row.text('date'))
    if (ts === null) {
      skipped.push({ row: number, reason: 'Date is missing or not a date' })
      return
    }
    const path = pathOf(row.text('path'))
    if (!path) {
      skipped.push({ row: number, reason: 'Path is missing' })
      return
    }
    hits.push({ row, ts, path, goal: yes(row.text('event')), session: row.text('session') ?? `row${number}` })
  })

  hits.sort((a, b) => a.ts - b.ts)
  const groups = new Map<string, Hit[]>()
  const lastSeen = new Map<string, { key: string; ts: number }>()
  for (const hit of hits) {
    const last = lastSeen.get(hit.session)
    const key = last && hit.ts - last.ts <= VISIT_GAP ? last.key : `${hit.session}:${hit.ts}`
    lastSeen.set(hit.session, { key, ts: hit.ts })
    const group = groups.get(key)
    if (group) group.push(hit)
    else groups.set(key, [hit])
  }

  const visits: ImportVisit[] = []
  for (const [id, group] of groups) {
    const first = group[0]
    if (!first) continue
    const { row } = first
    const { referrer, campaign } = referrerOf(row)
    const [country, region] = (row.text('location') ?? '').split('-')
    visits.push({
      id,
      visitor: first.session,
      startedAt: first.ts,
      hostname: null,
      referrer,
      utmSource: campaign,
      country: normalizeCountry(country),
      region: region ?? null,
      browser: normalizeBrowser(withoutVersion(row.text('browser'))),
      os: normalizeOs(withoutVersion(row.text('system'))),
      device: deviceOf(row.text('screensize')),
      events: group.map((hit): ImportEvent => ({
        ts: hit.ts,
        type: hit.goal ? 'goal' : 'pageview',
        name: hit.goal ? hit.path : null,
        path: hit.path,
      })),
    })
  }
  return { visits, skipped }
}
