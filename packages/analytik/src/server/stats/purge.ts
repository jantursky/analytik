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
  await storage.run('DELETE FROM bot_requests WHERE site_id = ? AND ts < ?', [siteId, before])
  await storage.run('DELETE FROM vitals WHERE site_id = ? AND ts < ?', [siteId, before])
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

/** Rows one chunk removes at the least; a run does as many chunks as its time budget allows. */
export const PURGE_CHUNK = 5000

export interface ChunkedPurge extends PurgeResult {
  /** False when the time budget ran out first: the next run carries on from where this one stopped. */
  done: boolean
}

/** A table the purge empties of old rows, by the time column that dates them. */
const DELETES = [
  { table: 'events', column: 'ts' },
  { table: 'sessions', column: 'started_at' },
  { table: 'bot_requests', column: 'ts' },
  { table: 'vitals', column: 'ts' },
  { table: 'payment_claims', column: 'ts' },
] as const

const SCRUBBED = 'email = NULL, name = NULL, customer_id = NULL, visitor_id = NULL, session_id = NULL'
const NOT_SCRUBBED =
  '(email IS NOT NULL OR name IS NOT NULL OR customer_id IS NOT NULL OR visitor_id IS NOT NULL OR session_id IS NOT NULL)'
const NO_SESSION = `NOT EXISTS (SELECT 1 FROM sessions s WHERE s.site_id = visitors.site_id AND s.visitor_id = visitors.id)`

/**
 * The same purge as `purgeBefore`, in bounded steps: each statement touches about `chunk` rows, and the run stops
 * between statements once `budgetMs` has passed, with `done: false`. Tables without an `id` column are cut by their
 * time column: the chunk ends at the time of its `chunk`-th oldest row, so a statement never covers the whole backlog.
 * Running it again continues, because the rows already removed or cleaned no longer match.
 */
export async function purgeChunked(
  ctx: Pick<Context, 'storage'>,
  siteId: string,
  before: number,
  budgetMs = Number.POSITIVE_INFINITY,
  chunk = PURGE_CHUNK,
): Promise<ChunkedPurge> {
  const { storage } = ctx
  const started = Date.now()
  const result: ChunkedPurge = { events: 0, sessions: 0, visitors: 0, done: true }

  /** Runs `statement` over the oldest matching rows, chunk by chunk; false when the budget ran out first. */
  const step = async (
    column: string,
    table: string,
    filter: string,
    statement: (bound: string) => string,
  ): Promise<{ changes: number; finished: boolean }> => {
    let changes = 0
    for (;;) {
      const [edge] = await storage.query<Record<string, number | string>>(
        `SELECT ${column} AS edge FROM ${table} WHERE site_id = ? AND ${column} < ?${filter} ORDER BY ${column} LIMIT 1 OFFSET ?`,
        [siteId, before, chunk - 1],
      )
      // Fewer than a chunk is left: one statement finishes the table.
      const last = edge === undefined
      const bound = last ? before : Number(edge.edge)
      const run = await storage.run(statement(last ? '<' : '<='), [siteId, bound])
      changes += run.changes
      if (last) return { changes, finished: true }
      if (Date.now() - started >= budgetMs) return { changes, finished: false }
    }
  }

  for (const { table, column } of DELETES) {
    const out = await step(column, table, '', (op) => `DELETE FROM ${table} WHERE site_id = ? AND ${column} ${op} ?`)
    if (table === 'events') result.events = out.changes
    if (table === 'sessions') result.sessions = out.changes
    if (!out.finished) return { ...result, done: false }
  }
  const scrub = await step(
    'ts',
    'payments',
    ` AND ${NOT_SCRUBBED}`,
    (op) => `UPDATE payments SET ${SCRUBBED} WHERE site_id = ? AND ts ${op} ? AND ${NOT_SCRUBBED}`,
  )
  if (!scrub.finished) return { ...result, done: false }
  const visitors = await step(
    'first_seen',
    'visitors',
    ` AND ${NO_SESSION}`,
    (op) => `DELETE FROM visitors WHERE site_id = ? AND first_seen ${op} ? AND ${NO_SESSION}`,
  )
  result.visitors = visitors.changes
  return { ...result, done: visitors.finished }
}
