import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'

import { createContext } from '../server/context'
import { importVisits } from '../server/import/core'
import { requireSite } from '../server/sites'
import { type CsvRecord, createCsvReader } from '../shared/import/csv'
import { prepareImport } from '../shared/import/prepare'
import { type ImportResult, type ImportSource, addResults, emptyResult } from '../shared/import/types'
import type { UmamiRow } from '../shared/import/umami'
import type { Storage } from '../storage/types'

export interface ImportFilesOptions {
  source: ImportSource
  /** Paths of the export files. Umami takes up to three (events, sessions, event data); the files are told apart by their columns. */
  files: readonly string[]
  /** The id of the site to import into. */
  site: string
  /** Called after each stored chunk with the number of visits stored or found so far and the total. */
  onProgress?: (done: number, total: number) => void
}

export interface ImportReport {
  result: ImportResult
  /** Rows the mapper could not use, with the file's table and the row's position. */
  skipped: { file: string; row: number; reason: string }[]
  /** Visits found in the files, before storing. */
  found: number
}

/** Visits stored per call, so a large file never becomes one huge statement list. */
const CHUNK = 500

async function readCsv(file: string): Promise<CsvRecord[]> {
  const reader = createCsvReader()
  const records: CsvRecord[] = []
  for await (const chunk of createReadStream(file, { encoding: 'utf8' })) records.push(...reader.push(chunk as string))
  records.push(...reader.end())
  return records
}

/** Rows of one file. A JSON file holds a list of rows, or an object of lists keyed by table name. */
async function readRows(file: string): Promise<Record<string, UmamiRow[]>> {
  if (extname(file).toLowerCase() !== '.json') return { rows: await readCsv(file) }
  const data = JSON.parse(await readFile(file, 'utf8')) as unknown
  if (Array.isArray(data)) return { rows: data as UmamiRow[] }
  if (data && typeof data === 'object') return data as Record<string, UmamiRow[]>
  throw new Error(`${file} is not a list of rows`)
}

/**
 * Reads export files of another analytics tool and stores their visits in a site. Everything is read and mapped
 * before the first row is written, so a wrong file stores nothing. Running it again with the same files adds nothing.
 */
export async function importFiles(storage: Storage, options: ImportFilesOptions): Promise<ImportReport> {
  await storage.migrate()
  const ctx = createContext({ storage })
  const site = await requireSite(ctx, options.site)

  const files = await Promise.all(options.files.map(async (name) => ({ name, parts: await readRows(name) })))
  const { visits, skipped } = prepareImport(options.source, files)

  let result = emptyResult()
  for (let index = 0; index < visits.length; index += CHUNK) {
    result = addResults(result, await importVisits(ctx, site, options.source, visits.slice(index, index + CHUNK)))
    options.onProgress?.(Math.min(index + CHUNK, visits.length), visits.length)
  }
  return { result, skipped, found: visits.length }
}
