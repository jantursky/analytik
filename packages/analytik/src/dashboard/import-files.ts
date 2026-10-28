import { type CsvRecord, createCsvReader } from '../shared/import/csv'
import { type PreparedImport, type ReadFile, chunkVisits, prepareImport } from '../shared/import/prepare'
import { type ImportResult, type ImportSource, addResults, emptyResult } from '../shared/import/types'
import type { ApiClient } from './api'

// Loaded on the first import, so the mappers stay out of the dashboard's main chunk.
export { chunkVisits, prepareImport }
export type { PreparedImport, ReadFile } from '../shared/import/prepare'

/** Reads a CSV file piece by piece, so a large export never sits in memory as one string next to its rows. */
async function readCsv(file: File): Promise<CsvRecord[]> {
  const reader = createCsvReader()
  const rows: CsvRecord[] = []
  if (typeof file.stream !== 'function') {
    rows.push(...reader.push(await file.text()))
  } else {
    const stream = file.stream().pipeThrough(new TextDecoderStream()).getReader()
    for (;;) {
      const { done, value } = await stream.read()
      if (done) break
      rows.push(...reader.push(value))
    }
  }
  rows.push(...reader.end())
  return rows
}

/** One chosen file as rows: a CSV, or a JSON list of rows, or a JSON object of lists keyed by table name. */
export async function readBrowserFile(file: File): Promise<ReadFile> {
  if (!/\.json$/i.test(file.name)) return { name: file.name, parts: { rows: await readCsv(file) } }
  const data = JSON.parse(await file.text()) as unknown
  if (Array.isArray(data)) return { name: file.name, parts: { rows: data as Record<string, unknown>[] } }
  if (data && typeof data === 'object') return { name: file.name, parts: data as ReadFile['parts'] }
  throw new Error(`${file.name} is not a list of rows`)
}

export interface ChunkRun {
  result: ImportResult
  /** Visits sent before the run ended. */
  done: number
  error?: string
}

/**
 * Sends the visits in chunks and adds up what the server stored. Stops after the current chunk when `cancelled()`
 * says so, or on the first error; `result` and `done` then say how far it got.
 */
export async function importChunks(
  client: ApiClient,
  siteId: string,
  source: ImportSource,
  prepared: PreparedImport,
  hooks: { onProgress: (done: number) => void; cancelled: () => boolean },
): Promise<ChunkRun> {
  const total = prepared.visits.length
  let result = emptyResult()
  let done = 0
  hooks.onProgress(done)
  try {
    for (const chunk of chunkVisits(prepared.visits)) {
      if (hooks.cancelled()) break
      result = addResults(result, await client.importVisits(siteId, source, chunk))
      done = Math.min(total, done + chunk.length)
      hooks.onProgress(done)
    }
  } catch (problem) {
    return { result, done, error: problem instanceof Error ? problem.message : String(problem) }
  }
  return { result, done }
}
