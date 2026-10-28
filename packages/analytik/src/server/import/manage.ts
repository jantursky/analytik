import type { ImportRemoval, ImportSource, ImportSummary } from '../../shared/import/types'
import type { Context } from '../context'

/** Imports per source with their date range and counts, for the list in Settings. */
export async function listImports(ctx: Context, siteId: string): Promise<ImportSummary[]> {
  const [visits, events] = await Promise.all([
    ctx.storage.query<{ imported: ImportSource; visits: number; first: number; last: number }>(
      `SELECT imported, COUNT(*) AS visits, MIN(started_at) AS first, MAX(started_at) AS last
       FROM sessions WHERE site_id = ? AND imported IS NOT NULL GROUP BY imported ORDER BY imported`,
      [siteId],
    ),
    ctx.storage.query<{ imported: ImportSource; events: number }>(
      `SELECT imported, COUNT(*) AS events FROM events WHERE site_id = ? AND imported IS NOT NULL GROUP BY imported`,
      [siteId],
    ),
  ])
  const eventCounts = new Map(events.map((row) => [row.imported, row.events]))
  return visits.map((row) => ({
    source: row.imported,
    visits: row.visits,
    events: eventCounts.get(row.imported) ?? 0,
    from: row.first,
    to: row.last,
  }))
}

/**
 * Deletes everything one source imported into a site, then the imported visitors left without visits.
 * Rows the tracker recorded are never touched: they have no `imported` marker and no `imp:` id.
 */
export async function removeImport(ctx: Context, siteId: string, source: ImportSource): Promise<ImportRemoval> {
  const { storage } = ctx
  const events = await storage.run('DELETE FROM events WHERE site_id = ? AND imported = ?', [siteId, source])
  const visits = await storage.run('DELETE FROM sessions WHERE site_id = ? AND imported = ?', [siteId, source])
  const visitors = await storage.run(
    `DELETE FROM visitors WHERE site_id = ? AND id LIKE ?
       AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.site_id = visitors.site_id AND s.visitor_id = visitors.id)`,
    [siteId, `imp:${source}:%`],
  )
  return { visits: visits.changes, events: events.changes, visitors: visitors.changes }
}
