import { GA4_REQUIRED, mapGa4 } from './ga4'
import { GOATCOUNTER_REQUIRED, mapGoatCounter, unversioned } from './goatcounter'
import { MATOMO_REQUIRED, mapMatomo } from './matomo'
import { POSTHOG_REQUIRED, mapPostHog } from './posthog'
import { type SourceRow, missingColumns, rowsOf } from './row'
import { SIMPLE_ANALYTICS_REQUIRED, mapSimpleAnalytics } from './simple-analytics'
import type { ImportSource, ImportVisit } from './types'
import { UMAMI_REQUIRED, type UmamiRow, type UmamiTable, detectUmamiTable, mapUmami } from './umami'

/**
 * One file as it was read: a CSV is `{ rows }`; a JSON file is either a list (`{ rows }`) or an object of lists keyed
 * by table name, which is kept as it is.
 */
export interface ReadFile {
  name: string
  parts: Record<string, SourceRow[]>
}

export interface PreparedImport {
  visits: ImportVisit[]
  /** Rows the mapper could not use. */
  skipped: { file: string; row: number; reason: string }[]
}

/** A file that is not what the chosen source exports; its message names the problem for the person importing. */
export class ImportFileError extends Error {}

const TABLE_KEYS: Record<string, UmamiTable> = {
  events: 'events',
  website_event: 'events',
  sessions: 'sessions',
  session: 'sessions',
  eventdata: 'eventData',
  event_data: 'eventData',
}

function prepareUmami(files: readonly ReadFile[]): PreparedImport {
  const tables = { events: [] as UmamiRow[], sessions: [] as UmamiRow[], eventData: [] as UmamiRow[] }
  for (const file of files) {
    for (const [key, rows] of Object.entries(file.parts)) {
      if (!Array.isArray(rows) || rows.length === 0) continue
      const table = key === 'rows' ? detectUmamiTable(Object.keys(rows[0] ?? {})) : TABLE_KEYS[key.toLowerCase()]
      if (!table) {
        throw new ImportFileError(
          `The file ${file.name} is not an Umami export: its columns match none of website_event, session and event_data`,
        )
      }
      tables[table].push(...rows)
    }
  }
  if (!tables.events.length) {
    throw new ImportFileError('no Umami events found: pass the website_event export (with url_path and created_at)')
  }
  const missing = missingColumns(Object.keys(tables.events[0] ?? {}), UMAMI_REQUIRED)
  if (missing.length) throw new ImportFileError(`the Umami events file lacks the column ${missing.join(', ')}`)
  const mapped = mapUmami(tables)
  return {
    visits: mapped.visits,
    skipped: mapped.skipped.map((item) => ({ file: item.table, row: item.row, reason: item.reason })),
  }
}

function prepareSimpleAnalytics(files: readonly ReadFile[]): PreparedImport {
  const rows = files.flatMap((file) => Object.values(file.parts).flat())
  if (!rows.length) throw new ImportFileError('no rows found in the Simple Analytics file')
  const missing = missingColumns(Object.keys(rows[0] ?? {}), SIMPLE_ANALYTICS_REQUIRED)
  if (missing.length) {
    throw new ImportFileError(
      `the Simple Analytics file lacks the column ${missing.join(', ')}; export it with fields=added_iso,path,...`,
    )
  }
  const mapped = mapSimpleAnalytics(rows)
  return { visits: mapped.visits, skipped: mapped.skipped.map((item) => ({ file: 'export', ...item })) }
}

function prepareMatomo(files: readonly ReadFile[]): PreparedImport {
  const rows = files.flatMap((file) => Object.values(file.parts).flat())
  if (!rows.length) throw new ImportFileError('no visits found in the Matomo file')
  const missing = MATOMO_REQUIRED.filter((name) => !rows.some((row) => name in row))
  if (missing.length) {
    throw new ImportFileError(
      `the Matomo file lacks the field ${missing.join(', ')}; export it with method=Live.getLastVisitsDetails&format=json`,
    )
  }
  const mapped = mapMatomo(rows)
  return { visits: mapped.visits, skipped: mapped.skipped.map((item) => ({ file: 'export', ...item })) }
}

function prepareGoatCounter(files: readonly ReadFile[]): PreparedImport {
  const rows = files.flatMap((file) => Object.values(file.parts).flat())
  if (!rows.length) throw new ImportFileError('no hits found in the GoatCounter file')
  const missing = missingColumns(Object.keys(unversioned(rows[0] ?? {})), GOATCOUNTER_REQUIRED)
  if (missing.length) throw new ImportFileError(`the GoatCounter file lacks the column ${missing.join(', ')}`)
  const mapped = mapGoatCounter(rows)
  return { visits: mapped.visits, skipped: mapped.skipped.map((item) => ({ file: 'export', ...item })) }
}

function prepareJsonEvents(
  files: readonly ReadFile[],
  label: string,
  required: readonly string[],
  map: (rows: ReturnType<typeof rowsOf>) => { visits: ImportVisit[]; skipped: { row: number; reason: string }[] },
  hint: string,
): PreparedImport {
  const rows = rowsOf(files)
  if (!rows.length) throw new ImportFileError(`no events found in the ${label} file`)
  const missing = required.filter((name) => !rows.some((row) => name in row))
  if (missing.length) throw new ImportFileError(`the ${label} file lacks the field ${missing.join(', ')}; ${hint}`)
  const mapped = map(rows)
  return { visits: mapped.visits, skipped: mapped.skipped.map((item) => ({ file: 'export', ...item })) }
}

/** Reads and maps the files of one source. Throws `ImportFileError` before anything is stored. */
export function prepareImport(source: ImportSource, files: readonly ReadFile[]): PreparedImport {
  if (source === 'umami') return prepareUmami(files)
  if (source === 'matomo') return prepareMatomo(files)
  if (source === 'ga4') {
    return prepareJsonEvents(files, 'GA4', GA4_REQUIRED, mapGa4, 'export the events_* table from BigQuery as JSON')
  }
  if (source === 'posthog') {
    return prepareJsonEvents(files, 'PostHog', POSTHOG_REQUIRED, mapPostHog, 'export events with their properties')
  }
  return source === 'goatcounter' ? prepareGoatCounter(files) : prepareSimpleAnalytics(files)
}

/** A request's worth of visits; matches what the server accepts in one call. */
export const CHUNK_VISITS = 200
export const CHUNK_EVENTS = 1000

/**
 * Splits visits into requests of at most 200 visits and 1000 events. A visit with more events than that is cut into
 * pieces with the same id, which the server joins again.
 */
export function chunkVisits(visits: readonly ImportVisit[]): ImportVisit[][] {
  const chunks: ImportVisit[][] = []
  let current: ImportVisit[] = []
  let events = 0
  const flush = (): void => {
    if (current.length) chunks.push(current)
    current = []
    events = 0
  }
  for (const visit of visits) {
    const startedAt = visit.startedAt ?? Math.min(...visit.events.map((event) => event.ts))
    for (let index = 0; index < visit.events.length; index += CHUNK_EVENTS) {
      const piece = visit.events.slice(index, index + CHUNK_EVENTS)
      if (current.length >= CHUNK_VISITS || events + piece.length > CHUNK_EVENTS) flush()
      current.push({ ...visit, startedAt, events: piece })
      events += piece.length
    }
  }
  flush()
  return chunks
}
