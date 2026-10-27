import { sha256Hex } from '../shared/crypto'
import { randomId } from '../shared/ids'
import { isValidTimeZone } from '../shared/time'
import type { PaymentProvider, PrivacyMode, Site } from '../shared/types'
import { cleanDomain } from '../shared/url'
import { AnalytikError, type Context } from './context'

export const PROVIDERS: readonly PaymentProvider[] = ['stripe', 'dodo', 'lemonsqueezy']
const MODES: readonly PrivacyMode[] = ['strict', 'enriched', 'persistent']

/** A site as stored, including what never leaves the server. */
export interface SiteRecord extends Site {
  apiKeyHash: string
  webhookSecrets: Partial<Record<PaymentProvider, string>>
  shareToken: string | null
}

interface SiteRow {
  id: string
  name: string
  domain: string
  timezone: string
  currency: string
  privacy_mode: PrivacyMode
  api_key_hash: string
  webhook_secrets: string
  retention_days: number | null
  allow_localhost: number
  ignored_ips: string
  share_token: string | null
  created_at: number
}

function parseJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

function toRecord(row: SiteRow): SiteRecord {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    timezone: row.timezone,
    currency: row.currency,
    privacyMode: row.privacy_mode,
    retentionDays: row.retention_days,
    allowLocalhost: Boolean(row.allow_localhost),
    ignoredIps: parseJson<string[]>(row.ignored_ips, []),
    createdAt: row.created_at,
    apiKeyHash: row.api_key_hash,
    webhookSecrets: parseJson(row.webhook_secrets, {}),
    shareToken: row.share_token,
  }
}

/** What the admin API returns: secrets replaced by "configured" flags. */
export function publicSite(record: SiteRecord): Site {
  const { apiKeyHash: _hash, webhookSecrets, ...site } = record
  return {
    ...site,
    webhooks: {
      stripe: !!webhookSecrets.stripe,
      dodo: !!webhookSecrets.dodo,
      lemonsqueezy: !!webhookSecrets.lemonsqueezy,
    },
  }
}

export async function getSite(ctx: Context, id: string): Promise<SiteRecord | null> {
  const [row] = await ctx.storage.query<SiteRow>('SELECT * FROM sites WHERE id = ?', [id])
  return row ? toRecord(row) : null
}

export async function requireSite(ctx: Context, id: string): Promise<SiteRecord> {
  const site = await getSite(ctx, id)
  if (!site) throw new AnalytikError('site not found', 404)
  return site
}

export async function listSites(ctx: Context): Promise<SiteRecord[]> {
  return (await ctx.storage.query<SiteRow>('SELECT * FROM sites ORDER BY created_at, name, id')).map(toRecord)
}

export const hashApiKey = (key: string): Promise<string> => sha256Hex(key)

export async function siteByApiKey(ctx: Context, key: string | undefined): Promise<SiteRecord | null> {
  if (!key) return null
  const [row] = await ctx.storage.query<SiteRow>('SELECT * FROM sites WHERE api_key_hash = ?', [await hashApiKey(key)])
  return row ? toRecord(row) : null
}

/** Fields an admin can set; `undefined` leaves a field unchanged. */
export interface SiteInput {
  name?: string
  domain?: string
  timezone?: string
  currency?: string
  privacyMode?: PrivacyMode
  retentionDays?: number | null
  allowLocalhost?: boolean
  ignoredIps?: string[]
  /** Set or (with null) remove a provider's webhook secret. */
  webhookSecrets?: Partial<Record<PaymentProvider, string | null>>
  /** true creates a new share token, null turns sharing off. */
  shareToken?: true | null
}

type Columns = Record<string, unknown>

function validate(input: Record<string, unknown>, current: SiteRecord | null): Columns {
  const columns: Columns = {}
  const fail = (message: string): never => {
    throw new AnalytikError(message)
  }
  if (input.domain !== undefined) {
    const domain = typeof input.domain === 'string' ? cleanDomain(input.domain) : null
    columns.domain = domain ?? fail('domain must look like example.com')
  }
  if (input.name !== undefined) {
    if (typeof input.name !== 'string' || !input.name.trim()) fail('name must be a non-empty string')
    columns.name = (input.name as string).trim().slice(0, 100)
  }
  if (input.timezone !== undefined) {
    if (typeof input.timezone !== 'string' || !isValidTimeZone(input.timezone)) fail('timezone must be an IANA name')
    columns.timezone = input.timezone
  }
  if (input.currency !== undefined) {
    if (typeof input.currency !== 'string' || !/^[a-z]{3}$/i.test(input.currency)) fail('currency must be ISO 4217')
    columns.currency = (input.currency as string).toUpperCase()
  }
  if (input.privacyMode !== undefined) {
    if (!MODES.includes(input.privacyMode as PrivacyMode)) fail(`privacyMode must be one of ${MODES.join(', ')}`)
    columns.privacy_mode = input.privacyMode
  }
  if (input.retentionDays !== undefined) {
    const days = input.retentionDays
    if (days !== null && (!Number.isInteger(days) || (days as number) < 1 || (days as number) > 36500)) {
      fail('retentionDays must be a whole number of days or null')
    }
    columns.retention_days = days
  }
  if (input.allowLocalhost !== undefined) {
    if (typeof input.allowLocalhost !== 'boolean') fail('allowLocalhost must be a boolean')
    columns.allow_localhost = input.allowLocalhost
  }
  if (input.ignoredIps !== undefined) {
    const ips = input.ignoredIps
    if (
      !Array.isArray(ips) ||
      ips.length > 100 ||
      !ips.every((ip) => typeof ip === 'string' && /^[\d.:a-f]{2,45}$/i.test(ip))
    ) {
      fail('ignoredIps must be a list of up to 100 IP addresses')
    }
    columns.ignored_ips = JSON.stringify(ips)
  }
  if (input.webhookSecrets !== undefined) {
    const secrets = input.webhookSecrets
    if (!secrets || typeof secrets !== 'object' || Array.isArray(secrets)) fail('webhookSecrets must be an object')
    const next: Record<string, string | null> = { ...current?.webhookSecrets }
    for (const [provider, secret] of Object.entries(secrets as Record<string, unknown>)) {
      if (!PROVIDERS.includes(provider as PaymentProvider)) fail(`unknown provider ${provider}`)
      if (secret !== null && (typeof secret !== 'string' || secret.length === 0 || secret.length > 500)) {
        fail(`webhook secret for ${provider} must be a string or null`)
      }
      next[provider] = secret as string | null
    }
    columns.webhook_secrets = JSON.stringify(Object.fromEntries(Object.entries(next).filter(([, secret]) => secret)))
  }
  return columns
}

export async function createSite(
  ctx: Context,
  input: Record<string, unknown>,
): Promise<{ site: SiteRecord; apiKey: string }> {
  if (input.domain === undefined) throw new AnalytikError('domain is required')
  const columns = validate(input, null)
  const apiKey = `ak_${randomId(32, ctx.random)}`
  const row = {
    id: randomId(12, ctx.random),
    name: columns.domain,
    timezone: 'UTC',
    currency: 'USD',
    privacy_mode: ctx.defaultMode,
    webhook_secrets: '{}',
    retention_days: null,
    allow_localhost: false,
    ignored_ips: '[]',
    ...columns,
    api_key_hash: await hashApiKey(apiKey),
    share_token: input.shareToken === true ? randomId(24, ctx.random) : null,
    created_at: ctx.now(),
  }
  const keys = Object.keys(row)
  await ctx.storage.run(
    `INSERT INTO sites (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
    Object.values(row),
  )
  return { site: await requireSite(ctx, row.id), apiKey }
}

export async function updateSite(ctx: Context, id: string, input: Record<string, unknown>): Promise<SiteRecord> {
  const current = await requireSite(ctx, id)
  const columns = validate(input, current)
  if (input.shareToken !== undefined) columns.share_token = input.shareToken === true ? randomId(24, ctx.random) : null
  const keys = Object.keys(columns)
  if (keys.length > 0) {
    await ctx.storage.run(`UPDATE sites SET ${keys.map((key) => `${key} = ?`).join(', ')} WHERE id = ?`, [
      ...Object.values(columns),
      id,
    ])
  }
  return requireSite(ctx, id)
}

export async function rotateApiKey(ctx: Context, id: string): Promise<string> {
  await requireSite(ctx, id)
  const apiKey = `ak_${randomId(32, ctx.random)}`
  await ctx.storage.run('UPDATE sites SET api_key_hash = ? WHERE id = ?', [await hashApiKey(apiKey), id])
  return apiKey
}

export async function deleteSite(ctx: Context, id: string): Promise<void> {
  await requireSite(ctx, id)
  await ctx.storage.batch(
    ['events', 'sessions', 'visitors', 'payments', 'payment_claims', 'funnels']
      .map((table) => ({ sql: `DELETE FROM ${table} WHERE site_id = ?`, params: [id] }))
      .concat({ sql: 'DELETE FROM sites WHERE id = ?', params: [id] }),
  )
}
