import { hmacSha256, toHex } from '../shared/crypto'
import { randomId } from '../shared/ids'
import {
  WEBHOOK_EVENTS,
  type Payment,
  type Props,
  type Webhook,
  type WebhookEvent,
  type WebhookFormat,
} from '../shared/types'
import { AnalytikError, type Context } from './context'
import { publicHost } from './public-host'
import type { SiteRecord } from './sites'

export const MAX_WEBHOOKS = 5
const MAX_URL = 500
/** One try may take this long; the redirect is never followed. */
export const WEBHOOK_TIMEOUT = 5000
/** The wait before the one retry. */
export const WEBHOOK_RETRY = 1000

interface WebhookRow {
  id: string
  site_id: string
  url: string
  secret: string
  events: string
  format: string
  paused: number
  last_status: string | null
  last_at: number | null
  created_at: number
}

const COLUMNS = 'id, site_id, url, secret, events, format, paused, last_status, last_at, created_at'

/** Why `text` cannot be a webhook address, or null. With `debug` on, http and local hosts are allowed for testing. */
export function webhookUrlProblem(text: unknown, debug: boolean): string | null {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_URL) {
    return `url must be text of at most ${MAX_URL} characters`
  }
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return 'url is not a valid address'
  }
  if (url.username || url.password) return 'url must not contain a user name or password'
  if (debug) return url.protocol === 'https:' || url.protocol === 'http:' ? null : 'url must be http or https'
  if (url.protocol !== 'https:') return 'url must start with https://'
  if (url.port !== '' && url.port !== '443') return 'url must use port 443'
  if (!publicHost(url.hostname)) return 'url must use a public host name, not an address or an internal name'
  return null
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).host
  } catch {
    return 'invalid'
  }
}

function parseEvents(text: string): WebhookEvent[] {
  try {
    const parsed = JSON.parse(text) as unknown
    if (Array.isArray(parsed)) return WEBHOOK_EVENTS.filter((event) => parsed.includes(event))
  } catch {
    // An unreadable list receives nothing.
  }
  return []
}

const toWebhook = (row: WebhookRow): Webhook => ({
  id: row.id,
  siteId: row.site_id,
  host: hostOf(row.url),
  events: parseEvents(row.events),
  format: row.format === 'chat' ? 'chat' : 'json',
  paused: Boolean(row.paused),
  lastStatus: row.last_status ?? null,
  lastAt: row.last_at ?? null,
  createdAt: row.created_at,
})

function parseEventList(value: unknown): WebhookEvent[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((event) => !WEBHOOK_EVENTS.includes(event as WebhookEvent))
  ) {
    throw new AnalytikError(`events must be a list of: ${WEBHOOK_EVENTS.join(', ')}`)
  }
  return WEBHOOK_EVENTS.filter((event) => value.includes(event))
}

function parseFormat(value: unknown): WebhookFormat {
  if (value !== 'json' && value !== 'chat') throw new AnalytikError('format must be json or chat')
  return value
}

export async function listWebhooks(ctx: Context, siteId: string): Promise<Webhook[]> {
  const rows = await ctx.storage.query<WebhookRow>(
    `SELECT ${COLUMNS} FROM outbound_webhooks WHERE site_id = ? ORDER BY created_at, id`,
    [siteId],
  )
  return rows.map(toWebhook)
}

/** Adds a webhook. The secret is in the answer once and cannot be read again. */
export async function createWebhook(
  ctx: Context,
  siteId: string,
  input: Record<string, unknown>,
): Promise<{ webhook: Webhook; secret: string }> {
  const problem = webhookUrlProblem(input.url, ctx.debug)
  if (problem) throw new AnalytikError(problem)
  const events = input.events === undefined ? [...WEBHOOK_EVENTS] : parseEventList(input.events)
  const format = input.format === undefined ? 'json' : parseFormat(input.format)
  const [count] = await ctx.storage.query<{ n: number }>(
    'SELECT COUNT(*) AS n FROM outbound_webhooks WHERE site_id = ?',
    [siteId],
  )
  if ((count?.n ?? 0) >= MAX_WEBHOOKS) throw new AnalytikError(`a site can have at most ${MAX_WEBHOOKS} webhooks`)
  const id = randomId(16, ctx.random)
  const secret = `whsec_${randomId(32, ctx.random)}`
  const createdAt = ctx.now()
  await ctx.storage.run(
    `INSERT INTO outbound_webhooks (id, site_id, url, secret, events, format, paused, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    [id, siteId, input.url, secret, JSON.stringify(events), format, createdAt],
  )
  const [row] = await ctx.storage.query<WebhookRow>(`SELECT ${COLUMNS} FROM outbound_webhooks WHERE id = ?`, [id])
  if (!row) throw new AnalytikError('webhook was not saved')
  return { webhook: toWebhook(row), secret }
}

/** Changes the events, format or pause switch; the address and secret stay (remove and add again to change them). */
export async function updateWebhook(
  ctx: Context,
  siteId: string,
  id: string,
  input: Record<string, unknown>,
): Promise<Webhook | null> {
  const sets: string[] = []
  const params: unknown[] = []
  if (input.events !== undefined) {
    sets.push('events = ?')
    params.push(JSON.stringify(parseEventList(input.events)))
  }
  if (input.format !== undefined) {
    sets.push('format = ?')
    params.push(parseFormat(input.format))
  }
  if (input.paused !== undefined) {
    if (typeof input.paused !== 'boolean') throw new AnalytikError('paused must be true or false')
    sets.push('paused = ?')
    params.push(input.paused ? 1 : 0)
  }
  if (sets.length > 0) {
    await ctx.storage.run(`UPDATE outbound_webhooks SET ${sets.join(', ')} WHERE id = ? AND site_id = ?`, [
      ...params,
      id,
      siteId,
    ])
  }
  const [row] = await ctx.storage.query<WebhookRow>(
    `SELECT ${COLUMNS} FROM outbound_webhooks WHERE id = ? AND site_id = ?`,
    [id, siteId],
  )
  return row ? toWebhook(row) : null
}

export async function deleteWebhook(ctx: Context, siteId: string, id: string): Promise<boolean> {
  const { changes } = await ctx.storage.run('DELETE FROM outbound_webhooks WHERE id = ? AND site_id = ?', [id, siteId])
  return changes > 0
}

/** What a receiver gets. No visitor id, session id, email or name, whatever the privacy mode. */
export interface GoalNotice {
  type: 'goal'
  name: string
  path: string
  props: Props | null
  ts: number
  source: string | null
}
export interface PaymentNotice {
  type: 'payment'
  id: string
  kind: Payment['kind']
  amount: number
  currency: string
  provider: string
  ts: number
  source: string | null
}
export type Notice = GoalNotice | PaymentNotice | { type: 'test'; ts: number }

function money(amount: number, currency: string): string {
  try {
    const format = new Intl.NumberFormat('en', { style: 'currency', currency })
    return format.format(amount / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2))
  } catch {
    return `${amount / 100} ${currency}`
  }
}

/** One line for Slack- and Discord-style incoming webhooks. */
export function chatLine(site: SiteRecord, notice: Notice): string {
  if (notice.type === 'goal') return `${site.name}: goal ${notice.name} on ${notice.path}`
  if (notice.type === 'payment') {
    const verb = notice.kind === 'refund' ? 'refund of' : 'payment of'
    return `${site.name}: ${verb} ${money(notice.amount, notice.currency)} via ${notice.provider}`
  }
  return `${site.name}: test message from analytik`
}

const sign = async (secret: string, seconds: number, body: string): Promise<string> =>
  `t=${seconds},v1=${toHex(await hmacSha256(secret, `${seconds}.${body}`))}`

async function attempt(ctx: Context, row: WebhookRow, body: string, deliveryId: string): Promise<string> {
  // Checked again here: a row written by hand must not turn the server into a proxy for its own network.
  if (webhookUrlProblem(row.url, ctx.debug)) return 'refused'
  try {
    const seconds = Math.floor(ctx.now() / 1000)
    const response = await ctx.webhookFetch(row.url, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT),
      headers: {
        'content-type': 'application/json',
        'user-agent': 'analytik-webhook',
        'x-analytik-delivery': deliveryId,
        'x-analytik-signature': await sign(row.secret, seconds, body),
      },
      body,
    })
    void response.body?.cancel().catch(() => undefined)
    return response.status >= 200 && response.status < 300 ? 'ok' : `HTTP ${response.status}`
  } catch (error) {
    return (error as Error).name === 'TimeoutError' ? 'timeout' : 'error'
  }
}

/** Sends one notice with the one retry, records the outcome when it changed, and never throws. Returns the outcome. */
async function deliver(ctx: Context, site: SiteRecord, row: WebhookRow, notice: Notice, retry = true): Promise<string> {
  const deliveryId = randomId(20, ctx.random)
  const payload =
    row.format === 'chat'
      ? { text: chatLine(site, notice), content: chatLine(site, notice) }
      : { delivery: deliveryId, site: { id: site.id, name: site.name, domain: site.domain }, ...notice }
  const body = JSON.stringify(payload)
  let status = await attempt(ctx, row, body, deliveryId)
  if (status !== 'ok' && status !== 'refused' && retry) {
    await new Promise((resolve) => setTimeout(resolve, WEBHOOK_RETRY))
    status = await attempt(ctx, row, body, deliveryId)
  }
  // Host only: the address of a chat webhook is a secret, and so is the signing secret.
  if (status !== 'ok') console.error(`analytik: webhook to ${hostOf(row.url)} failed (${status})`)
  if (status !== row.last_status) {
    try {
      await ctx.storage.run('UPDATE outbound_webhooks SET last_status = ?, last_at = ? WHERE id = ?', [
        status,
        ctx.now(),
        row.id,
      ])
    } catch (error) {
      console.error('analytik: webhook status was not saved', error)
    }
  }
  return status
}

/** The session's traffic source, for the notice; null when unknown. */
async function sourceOf(ctx: Context, siteId: string, sessionId: string | null): Promise<string | null> {
  if (!sessionId) return null
  const [row] = await ctx.storage.query<{ source: string | null }>(
    'SELECT source FROM sessions WHERE site_id = ? AND id = ?',
    [siteId, sessionId],
  )
  return row?.source ?? null
}

/** Sends a goal or payment to the site's webhooks that want it. Never throws. */
export async function deliverNotice(
  ctx: Context,
  site: SiteRecord,
  kind: WebhookEvent,
  notice: (source: string | null) => GoalNotice | PaymentNotice,
  sessionId: string | null,
): Promise<void> {
  try {
    const rows = await ctx.storage.query<WebhookRow>(
      `SELECT ${COLUMNS} FROM outbound_webhooks WHERE site_id = ? AND paused = 0`,
      [site.id],
    )
    const wanted = rows.filter((row) => parseEvents(row.events).includes(kind))
    if (wanted.length === 0) return
    const message = notice(await sourceOf(ctx, site.id, sessionId))
    await Promise.all(wanted.map((row) => deliver(ctx, site, row, message)))
  } catch (error) {
    console.error('analytik: webhooks failed', error)
  }
}

/** Sends a sample message to one webhook and reports the outcome (one try). */
export async function testWebhook(
  ctx: Context,
  site: SiteRecord,
  id: string,
): Promise<{ ok: boolean; status: string }> {
  const [row] = await ctx.storage.query<WebhookRow>(
    `SELECT ${COLUMNS} FROM outbound_webhooks WHERE id = ? AND site_id = ?`,
    [id, site.id],
  )
  if (!row) throw new AnalytikError('webhook not found', 404)
  const status = await deliver(ctx, site, row, { type: 'test', ts: ctx.now() }, false)
  return { ok: status === 'ok', status }
}
