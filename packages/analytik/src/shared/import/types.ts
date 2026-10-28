import type { Props } from '../types'

/** Where an import comes from; stored in the `imported` column of the rows it creates. */
export type ImportSource = 'umami' | 'simple-analytics' | 'matomo' | 'goatcounter' | 'ga4' | 'posthog'

export const IMPORT_SOURCES: readonly ImportSource[] = [
  'umami',
  'simple-analytics',
  'matomo',
  'goatcounter',
  'ga4',
  'posthog',
]

export function isImportSource(value: unknown): value is ImportSource {
  return IMPORT_SOURCES.includes(value as ImportSource)
}

export interface ImportEvent {
  /** The source's own id when it has one; otherwise the core derives one from the visit, time, type, path and name. */
  id?: string
  ts: number
  type: 'pageview' | 'goal'
  /** The goal name; null for pageviews. */
  name: string | null
  path: string
  props?: Props | null
}

/** One visit in the form every source mapper produces and the import core stores. Unknown fields are null. */
export interface ImportVisit {
  /** The source's session id, or one the mapper derived. Becomes part of the stored id. */
  id: string
  /** The source's visitor id or fingerprint; visitors are never merged with tracked ones. */
  visitor: string
  /** When omitted, the first event's time. */
  startedAt?: number
  durationMs?: number | null
  hostname?: string | null
  /** A full referrer URL or a bare domain. */
  referrer?: string | null
  utmSource?: string | null
  utmMedium?: string | null
  utmCampaign?: string | null
  utmTerm?: string | null
  utmContent?: string | null
  country?: string | null
  region?: string | null
  city?: string | null
  browser?: string | null
  os?: string | null
  device?: string | null
  events: ImportEvent[]
}

export interface ImportResult {
  visits: number
  events: number
  /** Visits and events that were stored by an earlier import and left alone. */
  existing: { visits: number; events: number }
  /** Visits and events older than the site's retention limit. */
  tooOld: { visits: number; events: number }
}

export function emptyResult(): ImportResult {
  return { visits: 0, events: 0, existing: { visits: 0, events: 0 }, tooOld: { visits: 0, events: 0 } }
}

export function addResults(a: ImportResult, b: ImportResult): ImportResult {
  return {
    visits: a.visits + b.visits,
    events: a.events + b.events,
    existing: { visits: a.existing.visits + b.existing.visits, events: a.existing.events + b.existing.events },
    tooOld: { visits: a.tooOld.visits + b.tooOld.visits, events: a.tooOld.events + b.tooOld.events },
  }
}

/** One import of a site as listed in Settings: everything stored for a source. */
export interface ImportSummary {
  source: ImportSource
  visits: number
  events: number
  /** Start of the earliest and latest imported visit, unix milliseconds. */
  from: number
  to: number
}

export interface ImportRemoval {
  visits: number
  events: number
  visitors: number
}
