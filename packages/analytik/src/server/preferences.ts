import type { Context } from './context'

/** The one key the dashboard uses; the table allows more, e.g. per-admin settings later. */
const DASHBOARD = 'dashboard'

/** The dashboard settings, or `{}` before anything was saved. The server stores them without reading them. */
export async function getPreferences(ctx: Context): Promise<Record<string, unknown>> {
  const [row] = await ctx.storage.query<{ value: string }>('SELECT value FROM preferences WHERE key = ?', [DASHBOARD])
  if (!row) return {}
  try {
    const value = JSON.parse(row.value) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** Replaces the dashboard settings. */
export async function savePreferences(ctx: Context, value: Record<string, unknown>): Promise<Record<string, unknown>> {
  await ctx.storage.run(
    `INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [DASHBOARD, JSON.stringify(value), ctx.now()],
  )
  return value
}
