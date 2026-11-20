import type { Context } from '../context'

/** What erasure needs of a server: a database and a clock, so the command line can use it without one. */
type Erasing = Pick<Context, 'storage' | 'now'>
import type { EraseResult, VisitorExport, VisitorSelector } from '../types'

/** Ids per statement: D1 and SQLite cap the number of bound parameters. */
const CHUNK = 100

const lower = (email: string): string => email.trim().toLowerCase()

const marks = (ids: readonly string[]): string => ids.map(() => '?').join(', ')

function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK))
  return out
}

/** The visitor ids a selector stands for: the id itself, or every visitor and payment that carries the email. */
async function visitorIds(ctx: Erasing, siteId: string, selector: VisitorSelector): Promise<string[]> {
  if ('visitor' in selector) return [selector.visitor]
  const email = lower(selector.email)
  const [visitors, payments] = await Promise.all([
    ctx.storage.query<{ id: string }>('SELECT id FROM visitors WHERE site_id = ? AND LOWER(email) = ?', [
      siteId,
      email,
    ]),
    ctx.storage.query<{ visitor_id: string }>(
      'SELECT DISTINCT visitor_id FROM payments WHERE site_id = ? AND LOWER(email) = ? AND visitor_id IS NOT NULL',
      [siteId, email],
    ),
  ])
  return [...new Set([...visitors.map((row) => row.id), ...payments.map((row) => row.visitor_id)])]
}

/**
 * Deletes everything held about one person of a site: their events, sessions, payment claims and visitor rows, and
 * clears what points at them on their payments (email, name, customer, visitor and session), which keep their
 * amounts so revenue stays right. Core Web Vitals hold no visitor id, so there is nothing of them to remove. The
 * statements are independent and safe to repeat, so a failure half way is finished by running it again.
 */
export async function eraseVisitor(ctx: Erasing, siteId: string, selector: VisitorSelector): Promise<EraseResult> {
  const { storage } = ctx
  const ids = await visitorIds(ctx, siteId, selector)
  const result: EraseResult = { events: 0, sessions: 0, visitors: 0, payments: 0, claims: 0 }
  for (const group of chunks(ids)) {
    const where = `site_id = ? AND visitor_id IN (${marks(group)})`
    const params = [siteId, ...group]
    result.events += (await storage.run(`DELETE FROM events WHERE ${where}`, params)).changes
    result.sessions += (await storage.run(`DELETE FROM sessions WHERE ${where}`, params)).changes
    result.claims += (await storage.run(`DELETE FROM payment_claims WHERE ${where}`, params)).changes
    result.payments += (
      await storage.run(
        `UPDATE payments SET email = NULL, name = NULL, customer_id = NULL, visitor_id = NULL, session_id = NULL
         WHERE ${where}`,
        params,
      )
    ).changes
    result.visitors += (
      await storage.run(`DELETE FROM visitors WHERE site_id = ? AND id IN (${marks(group)})`, params)
    ).changes
  }
  // Payments that carry the email but no visitor id (a checkout the browser never claimed).
  if ('email' in selector) {
    result.payments += (
      await storage.run(
        `UPDATE payments SET email = NULL, name = NULL, customer_id = NULL, visitor_id = NULL, session_id = NULL
         WHERE site_id = ? AND LOWER(email) = ?`,
        [siteId, lower(selector.email)],
      )
    ).changes
  }
  return result
}

/** Everything held about one person of a site, for a subject-access request: the same rows and fields as the export. */
export async function exportVisitor(ctx: Erasing, siteId: string, selector: VisitorSelector): Promise<VisitorExport> {
  const { storage } = ctx
  const ids = await visitorIds(ctx, siteId, selector)
  const visitors: Record<string, unknown>[] = []
  const sessions: Record<string, unknown>[] = []
  const events: Record<string, unknown>[] = []
  const payments: Record<string, unknown>[] = []
  for (const group of chunks(ids)) {
    const params = [siteId, ...group]
    visitors.push(
      ...(await storage.query(`SELECT * FROM visitors WHERE site_id = ? AND id IN (${marks(group)})`, params)),
    )
    const by = `site_id = ? AND visitor_id IN (${marks(group)})`
    sessions.push(...(await storage.query(`SELECT * FROM sessions WHERE ${by} ORDER BY started_at, id`, params)))
    events.push(...(await storage.query(`SELECT * FROM events WHERE ${by} ORDER BY ts, id`, params)))
    payments.push(...(await storage.query(`SELECT * FROM payments WHERE ${by} ORDER BY ts, id`, params)))
  }
  if ('email' in selector) {
    const known = new Set(payments.map((row) => row.id))
    const rows = await storage.query('SELECT * FROM payments WHERE site_id = ? AND LOWER(email) = ? ORDER BY ts, id', [
      siteId,
      lower(selector.email),
    ])
    payments.push(...rows.filter((row) => !known.has(row.id)))
  }
  return { version: 1, exportedAt: ctx.now(), siteId, subject: selector, visitors, sessions, events, payments }
}
