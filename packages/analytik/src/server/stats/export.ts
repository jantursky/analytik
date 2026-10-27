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
