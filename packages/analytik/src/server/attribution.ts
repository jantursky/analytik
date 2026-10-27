import { HOUR, MINUTE } from '../shared/time'
import type { PaymentKind, PaymentMatch } from '../shared/types'
import type { Statement } from '../storage/types'
import type { Context } from './context'
import type { SiteRecord } from './sites'

/** What attribution needs to know about a payment. */
export interface PaymentFacts {
  id: string
  ts: number
  kind: PaymentKind
  email: string | null
  customerId: string | null
  subscriptionId: string | null
  orderId: string | null
  visitorId?: string | null
  sessionId?: string | null
  renewal?: boolean
}

export interface VisitMatch {
  visitorId: string | null
  sessionId: string | null
  matchedBy: PaymentMatch | null
  renewal: boolean
}

/**
 * The visit that earns the credit: the visitor's latest visit with a source, falling back to their latest visit.
 * Parameters: site id, visitor id, latest start time.
 */
export const CREDITED_SESSION_SQL = `SELECT id FROM sessions WHERE site_id = ? AND visitor_id = ? AND started_at <= ?
  ORDER BY CASE WHEN channel = 'Direct' THEN 1 ELSE 0 END, started_at DESC LIMIT 1`

/** How far back a click to checkout can explain a payment. */
const CLICK_LOOKBACK = 3 * HOUR

const CHECKOUT_HOSTS = ['checkout.stripe.com', 'buy.stripe.com', 'dodopayments.com', 'lemonsqueezy.com']
const CHECKOUT_GOALS = ['checkout', 'buy', 'purchase']

/** SQL condition on events aliased `e`: an outbound click to a checkout host or a goal named like a purchase. */
const IS_CHECKOUT_CLICK = (() => {
  const like = (words: string[]) => words.map((word) => `LOWER(e.name) LIKE '%${word}%'`).join(' OR ')
  return `((e.type = 'outbound' AND (${like(CHECKOUT_HOSTS)})) OR (e.type = 'goal' AND (${like(CHECKOUT_GOALS)})))`
})()

interface Evidence {
  site: SiteRecord
  facts: PaymentFacts
  /** The customer's first earlier payment, when there is one; its visitor may be unknown. */
  earlier: { visitorId: string | null } | undefined
  renewal: boolean
}

type Rule = (ctx: Context, evidence: Evidence) => Promise<string | null>

const firstValue = async (ctx: Context, sql: string, params: unknown[]): Promise<string | null> => {
  const [row] = await ctx.storage.query<{ value: string | null }>(sql, params)
  return row?.value ?? null
}

/** Checkout metadata: a visitor id, or a session id that names its visitor. */
const fromMetadata: Rule = async (ctx, { site, facts }) => {
  if (facts.visitorId) return facts.visitorId
  if (!facts.sessionId) return null
  return firstValue(ctx, 'SELECT visitor_id AS value FROM sessions WHERE site_id = ? AND id = ?', [
    site.id,
    facts.sessionId,
  ])
}

/** A payment, subscription or order id the visitor's browser reported from the return page. */
const fromReturnPage: Rule = (ctx, { site, facts }) => {
  const keys = [facts.id, facts.subscriptionId ?? facts.id, facts.orderId ?? facts.id]
  return firstValue(
    ctx,
    'SELECT visitor_id AS value FROM payment_claims WHERE site_id = ? AND payment_id IN (?, ?, ?) ORDER BY ts LIMIT 1',
    [site.id, ...keys],
  )
}

/** Whoever made the customer's earlier payment. */
const fromCustomer: Rule = (_ctx, { earlier }) => Promise.resolve(earlier?.visitorId ?? null)

/** A visitor who identified with the payer's email. */
const fromEmail: Rule = (ctx, { site, facts }) =>
  facts.email
    ? firstValue(
        ctx,
        'SELECT id AS value FROM visitors WHERE site_id = ? AND email = ? ORDER BY first_seen DESC LIMIT 1',
        [site.id, facts.email],
      )
    : Promise.resolve(null)

/**
 * The one visitor who went to checkout shortly before a first payment. With several candidates, the one who came
 * back to the site after their click and right after the payment, if exactly one did. Needs ids kept across pages,
 * so never in strict mode.
 */
const fromTiming: Rule = async (ctx, { site, facts, renewal }) => {
  if (facts.kind !== 'payment' || renewal || site.privacyMode === 'strict') return null
  const from = facts.ts - CLICK_LOOKBACK
  // Visitors with another payment around this one already have their purchase explained.
  const candidates = await ctx.storage.query<{ visitor_id: string; clicked: number }>(
    `SELECT e.visitor_id, MAX(e.ts) AS clicked FROM events e
     WHERE e.site_id = ? AND e.ts BETWEEN ? AND ? AND ${IS_CHECKOUT_CLICK}
       AND e.visitor_id NOT IN (SELECT p.visitor_id FROM payments p WHERE p.site_id = ? AND p.kind = 'payment'
         AND p.visitor_id IS NOT NULL AND p.id <> ? AND p.ts BETWEEN ? AND ?)
     GROUP BY e.visitor_id ORDER BY clicked DESC LIMIT 50`,
    [site.id, from, facts.ts + 2 * MINUTE, site.id, facts.id, from, facts.ts + CLICK_LOOKBACK],
  )
  if (candidates.length <= 1) return candidates[0]?.visitor_id ?? null

  const clickedAt = new Map(candidates.map((row) => [row.visitor_id, row.clicked]))
  const views = await ctx.storage.query<{ visitor_id: string; ts: number }>(
    `SELECT visitor_id, ts FROM events WHERE site_id = ? AND type = 'pageview' AND ts BETWEEN ? AND ?
       AND visitor_id IN (${candidates.map(() => '?').join(', ')}) LIMIT 1000`,
    [site.id, facts.ts - MINUTE, facts.ts + 30 * MINUTE, ...clickedAt.keys()],
  )
  const returned = new Set<string>()
  for (const view of views) if (view.ts > (clickedAt.get(view.visitor_id) ?? Infinity)) returned.add(view.visitor_id)
  return returned.size === 1 ? ([...returned][0] ?? null) : null
}

/** Most reliable first. */
const RULES: [PaymentMatch, Rule][] = [
  ['metadata', fromMetadata],
  ['return_page', fromReturnPage],
  ['customer', fromCustomer],
  ['email', fromEmail],
  ['timing', fromTiming],
]

async function earlierPayment(ctx: Context, siteId: string, facts: PaymentFacts): Promise<Evidence['earlier']> {
  // The same buyer: matched on whichever of the customer id and the email this payment has.
  const keys: [column: string, value: string][] = []
  if (facts.customerId) keys.push(['customer_id', facts.customerId])
  if (facts.email) keys.push(['email', facts.email])
  if (!keys.length) return undefined
  const [row] = await ctx.storage.query<{ visitor_id: string | null }>(
    `SELECT visitor_id FROM payments WHERE site_id = ? AND kind = 'payment' AND id <> ? AND ts <= ?
       AND (${keys.map(([column]) => `${column} = ?`).join(' OR ')})
     ORDER BY CASE WHEN visitor_id IS NULL THEN 1 ELSE 0 END, ts LIMIT 1`,
    [siteId, facts.id, facts.ts, ...keys.map(([, value]) => value)],
  )
  return row && { visitorId: row.visitor_id }
}

/** Finds the visitor behind a payment, how they were found, the visit to credit, and whether it is a renewal. */
export async function attribute(ctx: Context, site: SiteRecord, facts: PaymentFacts): Promise<VisitMatch> {
  const earlier = await earlierPayment(ctx, site.id, facts)
  const evidence: Evidence = {
    site,
    facts,
    earlier,
    renewal: facts.renewal === true || (facts.kind === 'payment' && earlier !== undefined),
  }
  for (const [matchedBy, rule] of RULES) {
    const visitorId = await rule(ctx, evidence)
    if (!visitorId) continue
    const [credited] = await ctx.storage.query<{ id: string }>(CREDITED_SESSION_SQL, [
      site.id,
      visitorId,
      facts.ts + MINUTE,
    ])
    return { visitorId, sessionId: credited?.id ?? facts.sessionId ?? null, matchedBy, renewal: evidence.renewal }
  }
  return { visitorId: null, sessionId: null, matchedBy: null, renewal: evidence.renewal }
}

/** Query parameters on a return page that carry a payment, checkout, subscription or order id. */
const RETURN_PARAMS = ['payment_id', 'session_id', 'subscription_id', 'checkout_id', 'order_id']
const RETURN_ID = /^[\w-]{4,200}$/

/**
 * Remembers the payment ids on a return page for this visitor, and links an anonymous payment that is already
 * recorded with one of them (the webhook often arrives before the browser does).
 */
export function claimStatements(siteId: string, visitorId: string, url: URL, now: number): Statement[] {
  const statements: Statement[] = []
  for (const key of RETURN_PARAMS) {
    const paymentId = url.searchParams.get(key)
    if (!paymentId || !RETURN_ID.test(paymentId)) continue
    statements.push(
      {
        sql: 'INSERT INTO payment_claims (site_id, payment_id, visitor_id, ts) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
        params: [siteId, paymentId, visitorId, now],
      },
      {
        sql: `UPDATE payments SET visitor_id = ?, matched_by = 'return_page', session_id = (${CREDITED_SESSION_SQL})
              WHERE site_id = ? AND visitor_id IS NULL AND (id = ? OR subscription_id = ? OR order_id = ?)`,
        params: [visitorId, siteId, visitorId, now + MINUTE, siteId, paymentId, paymentId, paymentId],
      },
    )
  }
  return statements
}
