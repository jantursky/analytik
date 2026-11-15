import { DAY, HOUR, startOfBucket, tzOffset } from '../../shared/time'
import type { ApiKey, Payment } from '../../shared/types'
import type { Context } from '../context'
import { type SiteRecord, listSites } from '../sites'
import { breakdown } from '../stats/breakdown'
import { overview } from '../stats/overview'
import { toStatsQuery } from '../stats/query'
import {
  type SiteSummaryData,
  type SummaryData,
  oneLine,
  renderDown,
  renderKeyEvent,
  renderPayment,
  renderSummary,
  renderTest,
  summarySubject,
} from './render'
import { claim, getDownSince, getEmailSettings, markSent, release } from './settings'
import type { EmailSettings, ScheduledResult } from './types'

/** How long a webhook waits for the payment email. */
const ALERT_TIMEOUT = 8000

/** A silent site only counts as down while its last event is this recent; older ones are simply quiet. */
const DOWN_WINDOW = 8 * DAY

/** The recipient, or null when nothing should be sent (no sender, or no address anywhere). */
function recipient(ctx: Context, settings: EmailSettings): string | null {
  if (!ctx.email) return null
  return settings.to !== '' ? settings.to : (ctx.email.to ?? null)
}

/** Sends one email once per `key`. A failed send frees the key and throws. Returns false when it already went out. */
async function sendOnce(
  ctx: Context,
  key: string,
  to: string,
  content: { subject: string; text: string; html: string },
): Promise<boolean> {
  if (!ctx.email || !(await claim(ctx, key))) return false
  try {
    await ctx.email.send({ from: ctx.email.from, to, ...content })
    await markSent(ctx, key)
  } catch (error) {
    await release(ctx, key).catch(() => undefined)
    throw error
  }
  return true
}

/** Emails the owner about a payment that was just recorded. Never throws: a webhook must not fail over an email. */
export async function alertPayment(ctx: Context, site: SiteRecord, payment: Payment): Promise<void> {
  // Tracker-reported revenue (`client`) comes from the browser and is replaced by the provider's own payment later:
  // alerting on it would let any page flood the inbox and email twice for one order.
  if (!ctx.email || payment.kind !== 'payment' || payment.provider === 'client') return
  // A sender that hangs must not hold the webhook response.
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ALERT_TIMEOUT)
  })
  try {
    await Promise.race([deliverPaymentAlert(ctx, site, payment), timeout])
  } finally {
    clearTimeout(timer)
  }
}

async function deliverPaymentAlert(ctx: Context, site: SiteRecord, payment: Payment): Promise<void> {
  try {
    const settings = await getEmailSettings(ctx)
    const to = recipient(ctx, settings)
    if (!settings.payments || !to) return
    let source: string | null = null
    if (payment.sessionId) {
      const [row] = await ctx.storage.query<{ source: string | null }>(
        'SELECT source FROM sessions WHERE site_id = ? AND id = ?',
        [site.id, payment.sessionId],
      )
      source = row?.source ?? null
    }
    await sendOnce(ctx, `payment:${site.id}:${payment.id}`, to, renderPayment(payment, site, source))
  } catch (error) {
    console.error('analytik: payment alert failed', error)
  }
}

/**
 * Emails the owner about an API key event. Never throws and never waits longer than a few seconds: a key action must not
 * fail or hang over an email. Nothing is sent without a sender, a recipient or while the switch is off.
 */
export async function alertKeyEvent(
  ctx: Context,
  action: 'created' | 'rolled' | 'disabled' | 'deleted' | 'allowlist_changed',
  key: ApiKey,
): Promise<void> {
  if (!ctx.email) return
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ALERT_TIMEOUT)
  })
  const deliver = async () => {
    try {
      const settings = await getEmailSettings(ctx)
      const to = recipient(ctx, settings)
      if (!settings.apiKeyAlerts || !to || !ctx.email) return
      const content = renderKeyEvent({
        action,
        label: key.label,
        prefix: key.prefix,
        scope: key.scope,
        sites: key.siteIds.length,
        addresses: key.ipAllowlist.length,
        at: ctx.now(),
      })
      await ctx.email.send({ from: ctx.email.from, to, ...content })
    } catch (error) {
      console.error('analytik: API key alert failed', error)
    }
  }
  try {
    await Promise.race([deliver(), timeout])
  } finally {
    clearTimeout(timer)
  }
}

/** Sends a test message to `to` without recording anything; throws the sender's error. */
export async function sendTest(ctx: Context, to: string): Promise<void> {
  if (!ctx.email) return
  await ctx.email.send({ from: ctx.email.from, to, ...renderTest() })
}

const localDate = (at: number, timeZone: string): string =>
  new Date(at + tzOffset(timeZone, at)).toISOString().slice(0, 10)

async function siteSummary(ctx: Context, site: SiteRecord, from: number, to: number, tz: string) {
  const query = { from, to, tz }
  const [stats, sources, pages] = await Promise.all([
    overview(ctx, site, toStatsQuery(site, { ...query, compare: 'previous' }, ctx.storage.dialect)),
    breakdown(ctx, site, 'source', toStatsQuery(site, query, ctx.storage.dialect), 500),
    breakdown(ctx, site, 'page', toStatsQuery(site, query, ctx.storage.dialect), 500),
  ])
  return { name: site.name, domain: site.domain, overview: stats, sources, pages } satisfies SiteSummaryData
}

/** The summary when one is due and not yet sent: after the chosen hour on a day (daily) or on Monday (weekly). */
async function sendSummary(ctx: Context, settings: EmailSettings, to: string, url: string | undefined) {
  if (settings.summary === 'off') return null
  const kind = settings.summary
  const unit = kind === 'daily' ? 'day' : 'week'
  const tz = settings.timezone
  const now = ctx.now()
  const current = startOfBucket(now, unit, tz)
  if (now < current + settings.hour * HOUR) return null
  // The period just ended: yesterday, or last week from Monday to Sunday.
  const from = startOfBucket(current - 1, unit, tz)
  const key = `summary:${kind}:${localDate(current, tz)}`
  if (!(await claimable(ctx, key))) return null
  // One site at a time: many sites would otherwise open three heavy queries each at once.
  const sites: SiteSummaryData[] = []
  for (const site of await listSites(ctx)) sites.push(await siteSummary(ctx, site, from, current, tz))
  const last = localDate(current - 1, tz)
  const data: SummaryData = {
    kind,
    label: kind === 'daily' ? last : `${localDate(from, tz)} to ${last}`,
    sites,
    url,
  }
  const sent = await sendOnce(ctx, key, to, { subject: oneLine(summarySubject(data)), ...renderSummary(data) })
  return sent ? kind : null
}

/** Cheap look before the expensive queries; `sendOnce` still decides atomically. */
async function claimable(ctx: Context, key: string): Promise<boolean> {
  const rows = await ctx.storage.query('SELECT 1 AS sent FROM notification_log WHERE key = ?', [key])
  return rows.length === 0
}

/** Sites with traffic in the days before that have had no event for 24 hours, one alert per outage. */
async function sendDown(ctx: Context, to: string, alerted: string[], errors: unknown[]): Promise<void> {
  const now = ctx.now()
  const since = await getDownSince(ctx)
  for (const site of await listSites(ctx)) {
    if (site.paused) continue
    // One failing send must not hide the other sites' alerts.
    try {
      const [row] = await ctx.storage.query<{ last: number | string | null }>(
        'SELECT MAX(ts) AS last FROM events WHERE site_id = ?',
        [site.id],
      )
      const last = row?.last == null ? null : Number(row.last)
      if (last === null || last > now - DAY || last < now - DOWN_WINDOW) continue
      // Quiet for a day before the alert was switched on: not a new outage.
      if (last + DAY < since) continue
      // The outage starts with the last event, so a site that recovers and stops again is a new outage.
      if (await sendOnce(ctx, `down:${site.id}:${last}`, to, renderDown(site, last))) alerted.push(site.id)
    } catch (error) {
      errors.push(error)
    }
  }
}

/** Thrown by the scheduled work when something failed; `result` says what was sent before it did. */
export class ScheduledError extends Error {
  constructor(
    readonly errors: unknown[],
    readonly result: ScheduledResult,
  ) {
    super(errors.map((error) => (error instanceof Error ? error.message : String(error))).join('; '))
    this.name = 'ScheduledError'
  }
}

/** The hourly job: the due summary and the tracker-down alerts. A failure in one does not stop the other. */
export async function runScheduled(ctx: Context, url: string | undefined): Promise<ScheduledResult> {
  const result: ScheduledResult = { summary: null, down: [] }
  const settings = await getEmailSettings(ctx)
  const to = recipient(ctx, settings)
  if (!to) return result
  const errors: unknown[] = []
  try {
    result.summary = await sendSummary(ctx, settings, to, ctx.email?.url ?? url)
  } catch (error) {
    errors.push(error)
  }
  if (settings.down) await sendDown(ctx, to, result.down, errors)
  if (errors.length > 0) throw new ScheduledError(errors, result)
  return result
}
