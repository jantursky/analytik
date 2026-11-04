import { sha256Hex, toBase64Url } from '../shared/crypto'
import { randomId } from '../shared/ids'
import { DAY } from '../shared/time'
import { SHARE_VIEWS, type ShareLink, type ShareView } from '../shared/types'
import { AnalytikError, type Context } from './context'

const TOKEN_BYTES = 32
const MAX_LINKS = 50
const MAX_LABEL = 80
const MAX_EXPIRY_DAYS = 3650

interface LinkRow {
  id: string
  site_id: string
  label: string
  views: string
  created_at: number
  expires_at: number | null
  revoked_at: number | null
}

const COLUMNS = 'id, site_id, label, views, created_at, expires_at, revoked_at'

/** The stored view list, or null when it is damaged: a link whose limits can't be read must not open everything. */
function parseViews(text: string): ShareView[] | null {
  try {
    const parsed = JSON.parse(text) as unknown
    if (Array.isArray(parsed) && parsed.every((v) => SHARE_VIEWS.includes(v as ShareView))) return parsed as ShareView[]
  } catch {
    // Reported as null below.
  }
  return null
}

const toLink = (row: LinkRow, views: ShareView[]): ShareLink => ({
  id: row.id,
  siteId: row.site_id,
  label: row.label,
  views,
  createdAt: row.created_at,
  expiresAt: row.expires_at ?? null,
  revokedAt: row.revoked_at ?? null,
})

/** Checks a create request and returns what to store. */
function parseInput(input: Record<string, unknown>, now: number) {
  const label = input.label === undefined ? '' : input.label
  if (typeof label !== 'string' || label.length > MAX_LABEL) {
    throw new AnalytikError(`label must be text of at most ${MAX_LABEL} characters`)
  }
  const views = input.views === undefined ? [] : input.views
  if (!Array.isArray(views) || views.some((v) => !SHARE_VIEWS.includes(v as ShareView))) {
    throw new AnalytikError(`views must be a list of: ${SHARE_VIEWS.join(', ')}`)
  }
  let expiresAt: number | null = null
  if (input.expiresInDays !== undefined && input.expiresInDays !== null) {
    const days = input.expiresInDays
    if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > MAX_EXPIRY_DAYS) {
      throw new AnalytikError(`expiresInDays must be a whole number from 1 to ${MAX_EXPIRY_DAYS}`)
    }
    expiresAt = now + days * DAY
  }
  return { label: label.trim(), views: [...new Set(views as ShareView[])], expiresAt }
}

/** Creates a link and returns it with its token. Only the token's hash is stored, so this is the one time it is shown. */
export async function createShareLink(
  ctx: Context,
  siteId: string,
  input: Record<string, unknown>,
): Promise<{ link: ShareLink; token: string }> {
  const { label, views, expiresAt } = parseInput(input, ctx.now())
  const [count] = await ctx.storage.query<{ n: number }>(
    'SELECT COUNT(*) AS n FROM share_links WHERE site_id = ? AND revoked_at IS NULL',
    [siteId],
  )
  if ((count?.n ?? 0) >= MAX_LINKS) throw new AnalytikError(`a site can have at most ${MAX_LINKS} active links`)
  const token = toBase64Url(ctx.random(TOKEN_BYTES))
  const id = `sl_${randomId(12, ctx.random)}`
  const createdAt = ctx.now()
  await ctx.storage.run(
    'INSERT INTO share_links (id, site_id, token_hash, label, views, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, siteId, await sha256Hex(token), label, JSON.stringify(views), createdAt, expiresAt],
  )
  return { link: { id, siteId, label, views, createdAt, expiresAt, revokedAt: null }, token }
}

/** Every link of a site, newest first, revoked ones included so the list shows what happened. */
export async function listShareLinks(ctx: Context, siteId: string): Promise<ShareLink[]> {
  const rows = await ctx.storage.query<LinkRow>(
    `SELECT ${COLUMNS} FROM share_links WHERE site_id = ? ORDER BY created_at DESC, id`,
    [siteId],
  )
  return rows.map((row) => toLink(row, parseViews(row.views) ?? []))
}

/** Ends a link at once; revoking it twice keeps the first time. */
export async function revokeShareLink(ctx: Context, siteId: string, id: string): Promise<boolean> {
  const { changes } = await ctx.storage.run(
    'UPDATE share_links SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ? AND site_id = ?',
    [ctx.now(), id, siteId],
  )
  return changes > 0
}

/** The link a token opens for this site, or null when it is unknown, for another site, revoked or expired. */
export async function findShareLink(ctx: Context, siteId: string, token: string): Promise<ShareLink | null> {
  if (token.length < 20 || token.length > 128) return null
  const [row] = await ctx.storage.query<LinkRow>(
    `SELECT ${COLUMNS} FROM share_links WHERE token_hash = ? AND site_id = ?`,
    [await sha256Hex(token), siteId],
  )
  if (!row) return null
  const views = parseViews(row.views)
  if (!views) return null
  const link = toLink(row, views)
  if (link.revokedAt !== null) return null
  if (link.expiresAt !== null && link.expiresAt <= ctx.now()) return null
  return link
}

/** The views that make each shareable stats route available; a route outside this table is never shared. */
const ROUTE_VIEWS: Record<string, readonly ShareView[]> = {
  overview: ['overview', 'sources', 'pages', 'events'],
  timeseries: ['overview', 'sources', 'pages', 'events'],
  breakdown: ['overview', 'sources', 'pages', 'events', 'bots'],
  realtime: ['realtime', 'overview'],
  sessions: ['sessions'],
  events: ['events'],
  bots: ['bots'],
  funnels: ['funnels'],
}

/** Whether a link limited to `views` may read this stats route (`overview`, `sessions`, ...). */
export const linkAllows = (views: readonly ShareView[], route: string): boolean =>
  views.length === 0 ||
  route === 'shared' ||
  route === 'favicon' ||
  (ROUTE_VIEWS[route]?.some((v) => views.includes(v)) ?? false)
