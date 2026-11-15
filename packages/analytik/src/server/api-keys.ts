import { sha256Hex, toBase64Url } from '../shared/crypto'
import { randomId } from '../shared/ids'
import { DAY, HOUR, MINUTE } from '../shared/time'
import { API_KEY_SCOPES, type ApiKey, type ApiKeyEvent, type ApiKeyEventType, type ApiKeyScope } from '../shared/types'
import { AnalytikError, type Context } from './context'
import { normalizeAllowlist } from './ip-allowlist'

export const KEY_PREFIX = 'anl_'
const SECRET_BYTES = 32
const MAX_KEYS = 20
const MAX_LABEL = 80
const MAX_SITES = 100
const MAX_EXPIRY_DAYS = 3650
const MAX_GRACE_HOURS = 7 * 24
const MAX_EVENTS = 200
const TOUCH_EVERY = MINUTE

interface KeyRow {
  id: string
  label: string
  token_hash: string
  prefix: string
  scope: string
  site_ids: string
  created_at: number
  expires_at: number | null
  last_used_at: number | null
  disabled_at: number | null
  previous_hash: string | null
  previous_until: number | null
  ip_allowlist: string | null
}

const COLUMNS =
  'id, label, token_hash, prefix, scope, site_ids, created_at, expires_at, last_used_at, disabled_at, previous_hash, previous_until, ip_allowlist'

/** A secret that could be a key: the prefix and 43 URL-safe characters. Anything else is not looked up. */
export const looksLikeKey = (value: string): boolean => /^anl_[\w-]{43}$/.test(value)

function parseSiteIds(text: string): string[] {
  try {
    const parsed = JSON.parse(text) as unknown
    if (Array.isArray(parsed) && parsed.every((id) => typeof id === 'string')) return parsed
  } catch {
    // A list that cannot be read is treated as damaged below.
  }
  // A damaged list must never widen a key to every site.
  return ['\u0000']
}

function parseAllowlist(text: string | null): string[] {
  if (text === null) return []
  try {
    const parsed = JSON.parse(text) as unknown
    if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string')) return parsed
  } catch {
    // A list that cannot be read is treated as damaged below.
  }
  // A damaged list must never open a key to every address: this entry matches none.
  return ['damaged']
}

const stateOf = (row: KeyRow, now: number): ApiKey['state'] =>
  row.disabled_at !== null ? 'disabled' : row.expires_at !== null && row.expires_at <= now ? 'expired' : 'active'

const toKey = (row: KeyRow, now: number): ApiKey => ({
  id: row.id,
  label: row.label,
  prefix: row.prefix,
  scope: row.scope === 'write' ? 'write' : 'read',
  siteIds: parseSiteIds(row.site_ids),
  createdAt: row.created_at,
  expiresAt: row.expires_at ?? null,
  lastUsedAt: row.last_used_at ?? null,
  disabledAt: row.disabled_at ?? null,
  previousUntil: row.previous_hash !== null && (row.previous_until ?? 0) > now ? row.previous_until : null,
  ipAllowlist: parseAllowlist(row.ip_allowlist ?? null),
  state: stateOf(row, now),
})

function newSecret(ctx: Context): string {
  return `${KEY_PREFIX}${toBase64Url(ctx.random(SECRET_BYTES))}`
}

const displayPrefix = (secret: string): string => secret.slice(0, KEY_PREFIX.length + 4)

/** Appends to the audit log and keeps the newest rows. The secret never goes in. */
export async function recordKeyEvent(
  ctx: Context,
  type: ApiKeyEventType,
  key: { id: string; label: string },
  detail = '',
): Promise<void> {
  const at = ctx.now()
  await ctx.storage.run('INSERT INTO api_key_events (id, at, key_id, label, type, detail) VALUES (?, ?, ?, ?, ?, ?)', [
    `${String(at).padStart(14, '0')}_${randomId(8, ctx.random)}`,
    at,
    key.id,
    key.label,
    type,
    detail.slice(0, 200),
  ])
  await ctx.storage.run(
    'DELETE FROM api_key_events WHERE id NOT IN (SELECT id FROM api_key_events ORDER BY at DESC, id DESC LIMIT ?)',
    [MAX_EVENTS],
  )
}

export async function listKeyEvents(ctx: Context): Promise<ApiKeyEvent[]> {
  const rows = await ctx.storage.query<{
    id: string
    at: number
    key_id: string
    label: string
    type: ApiKeyEventType
    detail: string
  }>('SELECT id, at, key_id, label, type, detail FROM api_key_events ORDER BY at DESC, id DESC LIMIT ?', [MAX_EVENTS])
  return rows.map((row) => ({
    id: row.id,
    at: row.at,
    keyId: row.key_id,
    label: row.label,
    type: row.type,
    detail: row.detail,
  }))
}

async function parseSites(ctx: Context, value: unknown): Promise<string[]> {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string') || value.length > MAX_SITES) {
    throw new AnalytikError(`siteIds must be a list of at most ${MAX_SITES} site ids`)
  }
  const ids = [...new Set(value as string[])]
  for (const id of ids) {
    const [row] = await ctx.storage.query<{ id: string }>('SELECT id FROM sites WHERE id = ?', [id])
    if (!row) throw new AnalytikError(`site ${id} does not exist`)
  }
  return ids
}

/** Checks a create request and returns what to store. */
async function parseInput(ctx: Context, input: Record<string, unknown>) {
  const label = input.label === undefined ? '' : input.label
  if (typeof label !== 'string' || label.length > MAX_LABEL) {
    throw new AnalytikError(`label must be text of at most ${MAX_LABEL} characters`)
  }
  const scope = input.scope === undefined ? 'read' : input.scope
  if (!API_KEY_SCOPES.includes(scope as ApiKeyScope)) {
    throw new AnalytikError(`scope must be one of: ${API_KEY_SCOPES.join(', ')}`)
  }
  let expiresAt: number | null = null
  if (input.expiresInDays !== undefined && input.expiresInDays !== null) {
    const days = input.expiresInDays
    if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > MAX_EXPIRY_DAYS) {
      throw new AnalytikError(`expiresInDays must be a whole number from 1 to ${MAX_EXPIRY_DAYS}`)
    }
    expiresAt = ctx.now() + days * DAY
  }
  return {
    label: label.trim(),
    scope: scope as ApiKeyScope,
    siteIds: await parseSites(ctx, input.siteIds),
    expiresAt,
    ipAllowlist: normalizeAllowlist(input.ipAllowlist),
  }
}

/** Creates a key and returns it with its secret. Only the hash is stored, so this is the one time the secret is shown. */
export async function createApiKey(
  ctx: Context,
  input: Record<string, unknown>,
): Promise<{ key: ApiKey; secret: string }> {
  const { label, scope, siteIds, expiresAt, ipAllowlist } = await parseInput(ctx, input)
  const [count] = await ctx.storage.query<{ n: number }>('SELECT COUNT(*) AS n FROM api_keys')
  if ((count?.n ?? 0) >= MAX_KEYS) throw new AnalytikError(`at most ${MAX_KEYS} API keys are allowed`)
  const secret = newSecret(ctx)
  const id = `ky_${randomId(12, ctx.random)}`
  const createdAt = ctx.now()
  await ctx.storage.run(
    `INSERT INTO api_keys (id, label, token_hash, prefix, scope, site_ids, created_at, expires_at, ip_allowlist)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      label,
      await sha256Hex(secret),
      displayPrefix(secret),
      scope,
      JSON.stringify(siteIds),
      createdAt,
      expiresAt,
      ipAllowlist.length > 0 ? JSON.stringify(ipAllowlist) : null,
    ],
  )
  const key = await requireApiKey(ctx, id)
  await recordKeyEvent(
    ctx,
    'created',
    key,
    `${scope}, ${siteIds.length === 0 ? 'all sites' : `${siteIds.length} sites`}${ipAllowlist.length > 0 ? `, ${ipAllowlist.length} ${ipAllowlist.length === 1 ? 'address' : 'addresses'}` : ''}`,
  )
  return { key, secret }
}

async function row(ctx: Context, id: string): Promise<KeyRow | undefined> {
  const [found] = await ctx.storage.query<KeyRow>(`SELECT ${COLUMNS} FROM api_keys WHERE id = ?`, [id])
  return found
}

export async function requireApiKey(ctx: Context, id: string): Promise<ApiKey> {
  const found = await row(ctx, id)
  if (!found) throw new AnalytikError('API key not found', 404)
  return toKey(found, ctx.now())
}

/** Every key, newest first. */
export async function listApiKeys(ctx: Context): Promise<ApiKey[]> {
  const rows = await ctx.storage.query<KeyRow>(`SELECT ${COLUMNS} FROM api_keys ORDER BY created_at DESC, id`)
  const now = ctx.now()
  return rows.map((found) => toKey(found, now))
}

/**
 * Gives a key a new secret, keeping its id, label, scope, sites and expiry. With a grace period the old secret keeps
 * working for that many hours (at most a week), so a client can be switched over without a gap.
 */
export async function rollApiKey(
  ctx: Context,
  id: string,
  input: Record<string, unknown>,
): Promise<{ key: ApiKey; secret: string }> {
  const hours = input.graceHours === undefined ? 0 : input.graceHours
  if (typeof hours !== 'number' || !Number.isInteger(hours) || hours < 0 || hours > MAX_GRACE_HOURS) {
    throw new AnalytikError(`graceHours must be a whole number from 0 to ${MAX_GRACE_HOURS}`)
  }
  const current = await row(ctx, id)
  if (!current) throw new AnalytikError('API key not found', 404)
  const secret = newSecret(ctx)
  const now = ctx.now()
  await ctx.storage.run(
    `UPDATE api_keys SET token_hash = ?, prefix = ?, last_used_at = NULL, previous_hash = ?, previous_until = ? WHERE id = ?`,
    [
      await sha256Hex(secret),
      displayPrefix(secret),
      hours > 0 ? current.token_hash : null,
      hours > 0 ? now + hours * HOUR : null,
      id,
    ],
  )
  const key = await requireApiKey(ctx, id)
  await recordKeyEvent(ctx, 'rolled', key, hours > 0 ? `old secret works for ${hours} h` : 'old secret stopped at once')
  return { key, secret }
}

/**
 * Replaces a key's allow list; an empty list opens it to any address. The audit entry holds the counts before and after,
 * never the addresses.
 */
export async function setApiKeyAllowlist(ctx: Context, id: string, value: unknown): Promise<ApiKey> {
  const current = await row(ctx, id)
  if (!current) throw new AnalytikError('API key not found', 404)
  const list = normalizeAllowlist(value)
  await ctx.storage.run('UPDATE api_keys SET ip_allowlist = ? WHERE id = ?', [
    list.length > 0 ? JSON.stringify(list) : null,
    id,
  ])
  const before = parseAllowlist(current.ip_allowlist ?? null).length
  await recordKeyEvent(ctx, 'allowlist_changed', current, `${before} to ${list.length} addresses`)
  return requireApiKey(ctx, id)
}

/** Disables or enables a key; its settings and secret stay. Doing either twice changes nothing. */
export async function setApiKeyDisabled(ctx: Context, id: string, disabled: boolean): Promise<ApiKey> {
  const current = await row(ctx, id)
  if (!current) throw new AnalytikError('API key not found', 404)
  if ((current.disabled_at !== null) !== disabled) {
    await ctx.storage.run('UPDATE api_keys SET disabled_at = ? WHERE id = ?', [disabled ? ctx.now() : null, id])
    await recordKeyEvent(ctx, disabled ? 'disabled' : 'enabled', current)
  }
  return requireApiKey(ctx, id)
}

/** Removes a key for good; the audit log keeps the fact. */
export async function deleteApiKey(ctx: Context, id: string): Promise<ApiKey> {
  const current = await row(ctx, id)
  if (!current) throw new AnalytikError('API key not found', 404)
  const key = toKey(current, ctx.now())
  await ctx.storage.run('DELETE FROM api_keys WHERE id = ?', [id])
  await recordKeyEvent(ctx, 'deleted', key)
  return key
}

/**
 * The usable key a secret belongs to, or null. A rolled key's old secret counts while its grace period lasts. Disabled,
 * expired, deleted and unknown secrets are all just null, so the caller cannot tell them apart.
 */
export async function findApiKey(ctx: Context, secret: string): Promise<ApiKey | null> {
  if (!looksLikeKey(secret)) return null
  const hash = await sha256Hex(secret)
  const now = ctx.now()
  const [found] = await ctx.storage.query<KeyRow>(
    `SELECT ${COLUMNS} FROM api_keys WHERE token_hash = ? OR (previous_hash = ? AND previous_until > ?)`,
    [hash, hash, now],
  )
  if (!found || stateOf(found, now) !== 'active') return null
  // Reads must not turn into writes: the time is stored at most once a minute per key.
  if (found.last_used_at === null || found.last_used_at <= now - TOUCH_EVERY) {
    await ctx.storage.run('UPDATE api_keys SET last_used_at = ? WHERE id = ?', [now, found.id])
    found.last_used_at = now
  }
  return toKey(found, now)
}
