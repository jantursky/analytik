import type { Context } from '../context'
import { publicSite, type SiteRecord } from '../sites'
import type { ExportTable } from '../types'

export const EXPORT_TABLES: readonly ExportTable[] = ['visitors', 'sessions', 'events', 'payments']

const ORDER: Record<ExportTable, string> = {
  visitors: 'first_seen, id',
  sessions: 'started_at, id',
  events: 'ts, id',
  payments: 'ts, id',
}

type Reading = Pick<Context, 'storage' | 'now'>

/** Rows read per query while streaming; one page is all that is held at a time. */
export const EXPORT_PAGE = 1000

/** The column each table is paged and ordered by, with `id` as the tie-break. */
const KEY: Record<ExportTable | 'funnels', string> = {
  visitors: 'first_seen',
  sessions: 'started_at',
  events: 'ts',
  payments: 'ts',
  funnels: 'created_at',
}

const COLUMNS: Partial<Record<ExportTable | 'funnels', string>> = { funnels: 'id, name, steps, created_at' }

/** Reads a table page by page, resuming after the last row's (key, id), so no query skips or repeats a row. */
export async function* exportPages(
  ctx: Pick<Context, 'storage'>,
  siteId: string,
  table: ExportTable | 'funnels',
  size = EXPORT_PAGE,
): AsyncGenerator<Record<string, unknown>[]> {
  const key = KEY[table]
  let last: Record<string, unknown> | undefined
  for (;;) {
    const after = last ? ` AND (${key} > ? OR (${key} = ? AND id > ?))` : ''
    const params = last ? [siteId, last[key], last[key], last.id, size] : [siteId, size]
    const page = await ctx.storage.query(
      `SELECT ${COLUMNS[table] ?? '*'} FROM ${table} WHERE site_id = ?${after} ORDER BY ${key}, id LIMIT ?`,
      params,
    )
    if (page.length > 0) yield page
    if (page.length < size) return
    last = page[page.length - 1]
  }
}

function rows(ctx: Context, siteId: string, table: ExportTable): Promise<Record<string, unknown>[]> {
  return ctx.storage.query(`SELECT * FROM ${table} WHERE site_id = ? ORDER BY ${ORDER[table]}`, [siteId])
}

/** Everything stored for a site, for backups and moving between storages. Secrets are left out. */
export async function exportJson(ctx: Context, site: SiteRecord): Promise<string> {
  const [visitors, sessions, events, payments, funnels] = await Promise.all([
    ...EXPORT_TABLES.map((table) => rows(ctx, site.id, table)),
    ctx.storage.query('SELECT id, name, steps, created_at FROM funnels WHERE site_id = ? ORDER BY created_at, id', [
      site.id,
    ]),
  ])
  return JSON.stringify({
    version: 1,
    exportedAt: ctx.now(),
    site: publicSite(site),
    visitors,
    sessions,
    events,
    payments,
    funnels,
  })
}

/** Quotes a CSV cell and defuses values a spreadsheet would run as a formula. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'string' ? value.replace(/^[=+\-@\t\r]/, "'$&") : JSON.stringify(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export async function exportCsv(ctx: Context, site: SiteRecord, table: ExportTable): Promise<string> {
  const data = await rows(ctx, site.id, table)
  const first = data[0]
  if (!first) return ''
  const columns = Object.keys(first)
  const lines = [columns.join(','), ...data.map((row) => columns.map((column) => csvCell(row[column])).join(','))]
  return `${lines.join('\n')}\n`
}

/** Turns a generator of text pieces into a stream that reads the next piece only when the consumer asks for it. */
function streamOf(pieces: AsyncGenerator<string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await pieces.next()
        if (next.done) controller.close()
        else controller.enqueue(encoder.encode(next.value))
      } catch (error) {
        controller.error(error)
      }
    },
    async cancel() {
      await pieces.return(undefined)
    },
  })
}

async function* ndjson(ctx: Reading, site: SiteRecord, size: number): AsyncGenerator<string> {
  yield `${JSON.stringify({ version: 2, exportedAt: ctx.now(), site: publicSite(site) })}\n`
  for (const table of [...EXPORT_TABLES, 'funnels'] as const) {
    for await (const page of exportPages(ctx, site.id, table, size)) {
      yield page.map((row) => `${JSON.stringify({ table, ...row })}\n`).join('')
    }
  }
}

/** Version 2 of the backup: one JSON object per line, a header first, then every row with its `table`. */
export const exportNdjson = (ctx: Reading, site: SiteRecord, size = EXPORT_PAGE): ReadableStream<Uint8Array> =>
  streamOf(ndjson(ctx, site, size))

async function* csvLines(
  ctx: Pick<Context, 'storage'>,
  site: SiteRecord,
  table: ExportTable,
  size: number,
): AsyncGenerator<string> {
  let columns: string[] | undefined
  for await (const page of exportPages(ctx, site.id, table, size)) {
    let text = ''
    if (!columns) {
      columns = Object.keys(page[0] ?? {})
      text = `${columns.join(',')}\n`
    }
    const names = columns
    yield text + page.map((row) => `${names.map((column) => csvCell(row[column])).join(',')}\n`).join('')
  }
}

/** One table as CSV, the same columns and escaping as `exportCsv`, written page by page. */
export const exportCsvStream = (
  ctx: Pick<Context, 'storage'>,
  site: SiteRecord,
  table: ExportTable,
  size = EXPORT_PAGE,
): ReadableStream<Uint8Array> => streamOf(csvLines(ctx, site, table, size))

export interface ParsedExport {
  version: 1 | 2
  exportedAt: number
  site: unknown
  tables: Record<ExportTable | 'funnels', Record<string, unknown>[]>
}

/** Reads a backup of either version: the single document of version 1 or the lines of version 2. */
export function readExport(text: string): ParsedExport {
  const tables: ParsedExport['tables'] = { visitors: [], sessions: [], events: [], payments: [], funnels: [] }
  const head = JSON.parse(text.split('\n', 1)[0] ?? '') as Record<string, unknown>
  if (head.version === 1 || head.version === undefined) {
    const whole = JSON.parse(text) as Record<string, unknown>
    if (whole.version !== 1) throw new Error('not an analytik export')
    for (const name of Object.keys(tables) as (keyof typeof tables)[]) {
      const part = whole[name]
      if (Array.isArray(part)) tables[name] = part as Record<string, unknown>[]
    }
    return { version: 1, exportedAt: Number(whole.exportedAt), site: whole.site, tables }
  }
  if (head.version !== 2) throw new Error(`unknown export version ${JSON.stringify(head.version)}`)
  for (const line of text.split('\n').slice(1)) {
    if (line === '') continue
    const { table, ...row } = JSON.parse(line) as { table: keyof typeof tables } & Record<string, unknown>
    if (!(table in tables)) throw new Error(`unknown table ${table}`)
    tables[table].push(row)
  }
  return { version: 2, exportedAt: Number(head.exportedAt), site: head.site, tables }
}
