import { isId } from '../shared/ids'
import type { Payment, PaymentInput, PaymentKind, PaymentMatch } from '../shared/types'
import { clip } from '../shared/url'
import type { Statement } from '../storage/types'
import { type Attribution, attribute } from './attribution'
import { AnalytikError, type Context } from './context'
import type { SiteRecord } from './sites'
import type { RecordPaymentResult, RematchResult } from './types'

export interface PaymentRow {
  id: string
  site_id: string
  provider: string
  ts: number
  amount: number
  kind: PaymentKind
  currency: string
  visitor_id: string | null
  session_id: string | null
  customer_id: string | null
  email: string | null
  name: string | null
  renewal: number
  matched_by: PaymentMatch | null
  subscription_id: string | null
  order_id: string | null
}

export function toPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    siteId: row.site_id,
    provider: row.provider,
    ts: row.ts,
    amount: row.amount,
    kind: row.kind,
    currency: row.currency,
    visitorId: row.visitor_id,
    sessionId: row.session_id,
    customerId: row.customer_id,
    email: row.email,
    name: row.name,
    renewal: Boolean(row.renewal),
    matchedBy: row.matched_by,
    subscriptionId: row.subscription_id,
    orderId: row.order_id,
  }
}

interface Normalized {
  id: string
  amount: number
  currency: string
  kind: PaymentKind
  ts: number
  email: string | null
  name: string | null
  customerId: string | null
  subscriptionId: string | null
  orderId: string | null
  visitorId: string | null
  sessionId: string | null
  renewal: boolean
  refundedTotal: number | null
}

/** Validates untrusted payment input (API body, webhook mapping, tracker revenue event). */
export function normalizePayment(input: PaymentInput, now: number): Normalized {
  const id = clip(input.id, 200)
  if (!id) throw new AnalytikError('id is required')
  if (typeof input.amount !== 'number' || !Number.isFinite(input.amount))
    throw new AnalytikError('amount must be a number')
  if (typeof input.currency !== 'string' || !/^[a-z]{3}$/i.test(input.currency)) {
    throw new AnalytikError('currency must be ISO 4217')
  }
  const kind: PaymentKind = input.kind === 'refund' ? 'refund' : 'payment'
  const amount = Math.round(Math.abs(input.amount))
  return {
    id,
    amount: kind === 'refund' ? -amount : amount,
    currency: input.currency.toUpperCase(),
    kind,
    ts: typeof input.ts === 'number' && Number.isFinite(input.ts) ? Math.round(input.ts) : now,
    email: clip(input.email, 200)?.toLowerCase() ?? null,
    name: clip(input.name, 200),
    customerId: clip(input.customerId, 200),
    subscriptionId: clip(input.subscriptionId, 200),
    orderId: clip(input.orderId, 200),
    visitorId: isId(input.visitorId) ? input.visitorId : null,
    sessionId: isId(input.sessionId) ? input.sessionId : null,
    renewal: input.renewal === true,
    refundedTotal:
      kind === 'refund' && typeof input.refundedTotal === 'number' && input.refundedTotal > 0
        ? Math.round(input.refundedTotal)
        : null,
  }
}

function identifyVisitor(siteId: string, visitorId: string, email: string | null, name: string | null, ts: number) {
  return [
    {
      sql: 'INSERT INTO visitors (site_id, id, first_seen) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
      params: [siteId, visitorId, ts],
    },
    {
      sql: 'UPDATE visitors SET email = COALESCE(email, ?), name = COALESCE(name, ?) WHERE site_id = ? AND id = ?',
      params: [email, name, siteId, visitorId],
    },
  ]
}

async function findPayment(ctx: Context, siteId: string, id: string): Promise<PaymentRow | undefined> {
  const [row] = await ctx.storage.query<PaymentRow>('SELECT * FROM payments WHERE site_id = ? AND id = ?', [siteId, id])
  return row
}

/**
 * The payment a refund undoes: same id or order id, else the same subscription, else the customer's latest
 * payment before it (Stripe's first subscription charge and newer API versions share nothing else).
 */
async function refundedPayment(ctx: Context, siteId: string, refund: Normalized): Promise<PaymentRow | undefined> {
  const order = refund.orderId ?? refund.id
  const conditions = ['id = ?', 'order_id = ?']
  const params: unknown[] = [siteId, order, order]
  if (refund.subscriptionId) {
    conditions.push('subscription_id = ?')
    params.push(refund.subscriptionId)
  }
  if (refund.customerId) {
    conditions.push('(customer_id = ? AND ts <= ?)')
    params.push(refund.customerId, refund.ts)
  }
  const [row] = await ctx.storage.query<PaymentRow>(
    `SELECT * FROM payments WHERE site_id = ? AND kind = 'payment' AND (${conditions.join(' OR ')})
     ORDER BY CASE WHEN id = ? OR order_id = ? THEN 0 ELSE 1 END, ts DESC LIMIT 1`,
    [...params, order, order],
  )
  return row
}

/**
 * For refunds reported as a running total: the part not recorded yet, or the latest recorded refund of the
 * order when nothing is missing (a retried or out-of-order webhook).
 */
async function unrecordedRefund(
  ctx: Context,
  siteId: string,
  orderId: string,
  refundedTotal: number,
): Promise<number | PaymentRow> {
  const recorded = await ctx.storage.query<PaymentRow>(
    "SELECT * FROM payments WHERE site_id = ? AND kind = 'refund' AND order_id = ? ORDER BY ts DESC, id DESC",
    [siteId, orderId],
  )
  // Refunds are stored as negative amounts.
  const missing = recorded.reduce((total, row) => total + row.amount, refundedTotal)
  const [latest] = recorded
  return missing > 0 || !latest ? missing : latest
}

/**
 * Stores a payment or refund once per `(site, id)` and links it to the visit that earned it. Tracker revenue
 * (`client`) arrives as `client:<order id>`, so the browser can't take a provider's payment id; it is skipped
 * when a verified payment for the order exists, and a verified payment replaces it instead of counting twice.
 */
export async function recordPayment(
  ctx: Context,
  site: SiteRecord,
  input: PaymentInput,
  provider: string,
): Promise<RecordPaymentResult> {
  const payment = normalizePayment(input, ctx.now())
  const existing = await findPayment(ctx, site.id, payment.id)
  if (existing) return { payment: toPayment(existing), duplicate: true }
  const { storage } = ctx

  if (provider === 'client' && payment.orderId) {
    const [verified] = await storage.query<PaymentRow>(
      `SELECT * FROM payments WHERE site_id = ? AND kind = 'payment' AND provider <> 'client'
         AND (id = ? OR order_id = ?) LIMIT 1`,
      [site.id, payment.orderId, payment.orderId],
    )
    if (verified) return { payment: toPayment(verified), duplicate: true }
  }

  let match: Attribution
  if (payment.kind === 'refund') {
    if (payment.refundedTotal !== null) {
      payment.orderId ??= payment.id
      const missing = await unrecordedRefund(ctx, site.id, payment.orderId, payment.refundedTotal)
      if (typeof missing !== 'number') return { payment: toPayment(missing), duplicate: true }
      payment.amount = -missing
    }
    // A refund belongs to the visit its payment was credited to.
    const original = await refundedPayment(ctx, site.id, payment)
    match = {
      visitorId: original?.visitor_id ?? payment.visitorId,
      sessionId: original?.session_id ?? payment.sessionId,
      matchedBy: original?.matched_by ?? (payment.visitorId ? 'metadata' : null),
      renewal: false,
    }
    payment.customerId ??= original?.customer_id ?? null
    payment.email ??= original?.email ?? null
  } else {
    match = await attribute(ctx, site, payment)
  }

  const statements: Statement[] = [
    {
      sql: `INSERT INTO payments (id, site_id, provider, ts, amount, kind, currency, visitor_id, session_id, customer_id,
              email, name, renewal, matched_by, subscription_id, order_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      params: [
        payment.id,
        site.id,
        provider,
        payment.ts,
        payment.amount,
        payment.kind,
        payment.currency,
        match.visitorId,
        match.sessionId,
        payment.customerId,
        payment.email,
        payment.name,
        match.renewal,
        match.matchedBy,
        payment.subscriptionId,
        payment.orderId,
      ],
    },
  ]
  if (provider !== 'client' && payment.kind === 'payment') {
    statements.push({
      sql: "DELETE FROM payments WHERE site_id = ? AND provider = 'client' AND id IN (?, ?)",
      params: [site.id, `client:${payment.id}`, `client:${payment.orderId ?? payment.id}`],
    })
  }
  // A payment tells us who an anonymous visitor is.
  if (match.visitorId && payment.kind === 'payment' && (payment.email || payment.name)) {
    statements.push(...identifyVisitor(site.id, match.visitorId, payment.email, payment.name, payment.ts))
  }
  await storage.batch(statements)
  return {
    payment: {
      id: payment.id,
      siteId: site.id,
      provider,
      ts: payment.ts,
      amount: payment.amount,
      kind: payment.kind,
      currency: payment.currency,
      visitorId: match.visitorId,
      sessionId: match.sessionId,
      customerId: payment.customerId,
      email: payment.email,
      name: payment.name,
      renewal: match.renewal,
      matchedBy: match.matchedBy,
      subscriptionId: payment.subscriptionId,
      orderId: payment.orderId,
    },
    duplicate: false,
  }
}

/** Tries again to link payments that have no visitor yet, e.g. ones that arrived before the return-page visit. */
export async function rematchPayments(ctx: Context, site: SiteRecord): Promise<RematchResult> {
  const rows = await ctx.storage.query<PaymentRow>(
    `SELECT * FROM payments WHERE site_id = ? AND kind = 'payment' AND visitor_id IS NULL ORDER BY ts LIMIT 500`,
    [site.id],
  )
  let matched = 0
  for (const row of rows) {
    const match = await attribute(ctx, site, {
      id: row.id,
      ts: row.ts,
      kind: 'payment',
      email: row.email,
      customerId: row.customer_id,
      subscriptionId: row.subscription_id,
      orderId: row.order_id,
      renewal: Boolean(row.renewal),
    })
    if (!match.visitorId) continue
    matched++
    await ctx.storage.batch([
      {
        sql: 'UPDATE payments SET visitor_id = ?, session_id = ?, matched_by = ?, renewal = ? WHERE site_id = ? AND id = ?',
        params: [match.visitorId, match.sessionId, match.matchedBy, match.renewal, site.id, row.id],
      },
      // Refunds follow their payment.
      {
        sql: `UPDATE payments SET visitor_id = ?, session_id = ?, matched_by = ?
              WHERE site_id = ? AND kind = 'refund' AND visitor_id IS NULL AND order_id IN (?, ?)`,
        params: [match.visitorId, match.sessionId, match.matchedBy, site.id, row.id, row.order_id ?? row.id],
      },
      ...identifyVisitor(site.id, match.visitorId, row.email, row.name, row.ts),
    ])
  }
  return { checked: rows.length, matched }
}
