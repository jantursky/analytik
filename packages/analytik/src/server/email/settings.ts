import { isValidTimeZone } from '../../shared/time'
import { AnalytikError, type Context } from '../context'
import type { EmailSettings, SummaryFrequency } from './types'

const KEY = 'email'
const DOWN_SINCE = 'email-down-since'
const FREQUENCIES: readonly SummaryFrequency[] = ['off', 'daily', 'weekly']
const ADDRESS = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/

export const DEFAULT_SETTINGS: EmailSettings = {
  to: '',
  payments: false,
  summary: 'off',
  hour: 8,
  down: false,
  timezone: 'UTC',
  apiKeyAlerts: true,
}

/** Rebuilds the settings from stored or sent JSON, keeping only valid fields so a bad value can't break the schedule. */
export function parseSettings(value: unknown): EmailSettings {
  const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const settings = { ...DEFAULT_SETTINGS }
  if (typeof input.to === 'string' && (input.to === '' || ADDRESS.test(input.to))) settings.to = input.to
  if (typeof input.payments === 'boolean') settings.payments = input.payments
  if (typeof input.down === 'boolean') settings.down = input.down
  if (typeof input.apiKeyAlerts === 'boolean') settings.apiKeyAlerts = input.apiKeyAlerts
  if (FREQUENCIES.includes(input.summary as SummaryFrequency)) settings.summary = input.summary as SummaryFrequency
  if (Number.isInteger(input.hour) && (input.hour as number) >= 0 && (input.hour as number) <= 23) {
    settings.hour = input.hour as number
  }
  if (typeof input.timezone === 'string' && isValidTimeZone(input.timezone)) settings.timezone = input.timezone
  return settings
}

async function setSetting(ctx: Context, key: string, value: string): Promise<void> {
  await ctx.storage.run(
    `INSERT INTO notification_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, ctx.now()],
  )
}

/** When the tracker-down alert was last switched on (unix ms); 0 when it never was. */
export async function getDownSince(ctx: Context): Promise<number> {
  const [row] = await ctx.storage.query<{ value: string }>('SELECT value FROM notification_settings WHERE key = ?', [
    DOWN_SINCE,
  ])
  return Number(row?.value ?? 0) || 0
}

export async function getEmailSettings(ctx: Context): Promise<EmailSettings> {
  const [row] = await ctx.storage.query<{ value: string }>('SELECT value FROM notification_settings WHERE key = ?', [
    KEY,
  ])
  if (!row) return { ...DEFAULT_SETTINGS }
  try {
    return parseSettings(JSON.parse(row.value))
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/** Checks what the admin sent, field by field, and stores it. Unknown fields are dropped. */
export async function saveEmailSettings(ctx: Context, input: Record<string, unknown>): Promise<EmailSettings> {
  if (input.to !== undefined && !(typeof input.to === 'string' && (input.to === '' || ADDRESS.test(input.to)))) {
    throw new AnalytikError('to must be an email address')
  }
  for (const key of ['payments', 'down', 'apiKeyAlerts'] as const) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean')
      throw new AnalytikError(`${key} must be true or false`)
  }
  if (input.summary !== undefined && !FREQUENCIES.includes(input.summary as SummaryFrequency)) {
    throw new AnalytikError('summary must be off, daily or weekly')
  }
  if (
    input.hour !== undefined &&
    !(Number.isInteger(input.hour) && (input.hour as number) >= 0 && (input.hour as number) <= 23)
  ) {
    throw new AnalytikError('hour must be a whole number from 0 to 23')
  }
  if (input.timezone !== undefined && !(typeof input.timezone === 'string' && isValidTimeZone(input.timezone))) {
    throw new AnalytikError('timezone must be an IANA time zone')
  }
  const before = await getEmailSettings(ctx)
  const settings = parseSettings({ ...before, ...input })
  // Only outages that begin after the alert was switched on are reported, not every site that has been quiet for days.
  if (settings.down && !before.down) await setSetting(ctx, DOWN_SINCE, String(ctx.now()))
  await setSetting(ctx, KEY, JSON.stringify(settings))
  return settings
}

/** A reservation that is still `sending` after this long was left by a run that died; another run may take it over. */
const STALE_CLAIM_MS = 10 * 60_000

/**
 * Writes the log row that reserves one email; false when it was already sent or another run is sending it. A
 * reservation abandoned by a crashed run is taken over once it is stale.
 */
export async function claim(ctx: Context, key: string): Promise<boolean> {
  const now = ctx.now()
  const { changes } = await ctx.storage.run(
    "INSERT INTO notification_log (key, sent_at, status) VALUES (?, ?, 'sending') ON CONFLICT DO NOTHING",
    [key, now],
  )
  if (changes > 0) return true
  const taken = await ctx.storage.run(
    "UPDATE notification_log SET sent_at = ? WHERE key = ? AND status = 'sending' AND sent_at < ?",
    [now, key, now - STALE_CLAIM_MS],
  )
  return taken.changes > 0
}

/** Records that the email went out, so the reservation is never taken over. */
export async function markSent(ctx: Context, key: string): Promise<void> {
  await ctx.storage.run("UPDATE notification_log SET status = 'sent', sent_at = ? WHERE key = ?", [ctx.now(), key])
}

/** Frees the reservation of an email that failed, so the next run tries again. */
export async function release(ctx: Context, key: string): Promise<void> {
  await ctx.storage.run('DELETE FROM notification_log WHERE key = ?', [key])
}
