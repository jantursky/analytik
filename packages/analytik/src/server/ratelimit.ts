import { DAY } from '../shared/time'
import type { Context } from './context'

/** Counts a hit in the current fixed window and returns the count so far, this hit included. */
export async function hit(ctx: Context, key: string, windowMs: number): Promise<number> {
  const now = ctx.now()
  const windowStart = Math.floor(now / windowMs) * windowMs
  const [row] = await ctx.storage.query<{ count: number }>(
    `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start = excluded.window_start THEN rate_limits.count + 1 ELSE 1 END,
       window_start = excluded.window_start
     RETURNING count`,
    [key, windowStart],
  )
  const count = row?.count ?? 1
  // A new window is a cheap moment to drop counters nobody has touched for a day.
  if (count === 1) await ctx.storage.run('DELETE FROM rate_limits WHERE window_start < ?', [now - DAY])
  return count
}

/** Hits counted so far in the current window, without counting one. */
export async function hits(ctx: Context, key: string, windowMs: number): Promise<number> {
  const windowStart = Math.floor(ctx.now() / windowMs) * windowMs
  const [row] = await ctx.storage.query<{ count: number }>(
    'SELECT count FROM rate_limits WHERE key = ? AND window_start = ?',
    [key, windowStart],
  )
  return row?.count ?? 0
}

export async function reset(ctx: Context, key: string): Promise<void> {
  await ctx.storage.run('DELETE FROM rate_limits WHERE key = ?', [key])
}
