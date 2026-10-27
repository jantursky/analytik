import { hmacSha256, toHex } from '../shared/crypto'
import { randomId } from '../shared/ids'
import { monthKey } from '../shared/time'
import type { PrivacyMode } from '../shared/types'
import type { Context } from './context'

const LEVEL: Record<PrivacyMode, number> = { strict: 0, enriched: 1, persistent: 2 }

/**
 * The mode an event is processed in: never more than the site allows, never more than the tracker
 * asked for (no `m` means `strict`), and `strict` when the browser sent Do Not Track or Global Privacy Control.
 */
export function effectiveMode(site: PrivacyMode, requested: PrivacyMode | undefined, doNotTrack: boolean): PrivacyMode {
  if (doNotTrack || !requested) return 'strict'
  return LEVEL[requested] < LEVEL[site] ? requested : site
}

/**
 * The salt for the UTC month containing `at`, created on first use. Loading a new month's salt also
 * deletes every older one, which makes the previous month's visitor ids impossible to link again.
 * Newer months are left alone, so an instance whose clock lags can't delete the current salt.
 */
export async function monthSalt(ctx: Context, at: number): Promise<string> {
  const month = monthKey(at)
  const cached = ctx.salts.get(month)
  if (cached) return cached
  const { storage } = ctx
  await storage.run('INSERT INTO salts (month, value, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', [
    month,
    randomId(32, ctx.random),
    at,
  ])
  await storage.run('DELETE FROM salts WHERE month < ?', [month])
  const [row] = await storage.query<{ value: string }>('SELECT value FROM salts WHERE month = ?', [month])
  // Another instance may have purged the row in between; one more insert settles it.
  const value = row?.value ?? (await monthSalt(ctx, at))
  ctx.salts.clear()
  ctx.salts.set(month, value)
  return value
}

/** Strict-mode visitor id: HMAC of site, IP and user agent under the month salt. Nothing is stored on the device. */
export async function strictVisitorId(
  ctx: Context,
  siteId: string,
  ip: string,
  userAgent: string,
  at: number,
): Promise<string> {
  const salt = await monthSalt(ctx, at)
  return toHex(await hmacSha256(salt, `${siteId}\n${ip}\n${userAgent}`)).slice(0, 32)
}

/** A one-way key for rate limits, so IPs never reach the database. */
export async function hashedKey(ctx: Context, scope: string, value: string): Promise<string> {
  const salt = await monthSalt(ctx, ctx.now())
  return `${scope}:${toHex(await hmacSha256(salt, value)).slice(0, 32)}`
}
