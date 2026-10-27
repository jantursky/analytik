import type { Context } from '../context'
import type { PurgeResult } from '../types'

/**
 * Deletes events, sessions and return-page claims before `before`, then visitors left without sessions.
 * Older payments stay for the revenue numbers, but lose everything that points at a person.
 */
export async function purgeBefore(ctx: Context, siteId: string, before: number): Promise<PurgeResult> {
  const { storage } = ctx
  const events = await storage.run('DELETE FROM events WHERE site_id = ? AND ts < ?', [siteId, before])
  const sessions = await storage.run('DELETE FROM sessions WHERE site_id = ? AND started_at < ?', [siteId, before])
  await storage.run('DELETE FROM payment_claims WHERE site_id = ? AND ts < ?', [siteId, before])
  await storage.run(
    `UPDATE payments SET email = NULL, name = NULL, customer_id = NULL, visitor_id = NULL, session_id = NULL
     WHERE site_id = ? AND ts < ?`,
    [siteId, before],
  )
  const visitors = await storage.run(
    `DELETE FROM visitors WHERE site_id = ? AND first_seen < ?
       AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.site_id = visitors.site_id AND s.visitor_id = visitors.id)`,
    [siteId, before],
  )
  return { events: events.changes, sessions: sessions.changes, visitors: visitors.changes }
}
