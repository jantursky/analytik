import { hmacSha256, timingSafeEqual, toHex } from '../shared/crypto'
import type { PaymentInput } from '../shared/types'
import {
  type Json,
  type WebhookRequest,
  attributionFrom,
  compact,
  number,
  object,
  string,
  timestamp,
  withinTolerance,
} from './shared'

export type { WebhookRequest } from './shared'

/**
 * Checks the `Stripe-Signature` header: HMAC-SHA256 over `<t>.<body>` with the endpoint secret (`whsec_...`),
 * hex encoded in one or more `v1=` entries, with `t` within five minutes.
 */
export async function verify({ headers, body, secret, now = Date.now() }: WebhookRequest): Promise<boolean> {
  const header = headers.get('stripe-signature')
  if (!header) return false
  let time: string | undefined
  const signatures: string[] = []
  for (const part of header.split(',')) {
    const [key, value] = part.trim().split('=', 2)
    if (key === 't') time = value
    else if (key === 'v1' && value) signatures.push(value)
  }
  if (!time || !withinTolerance(Number(time), now)) return false
  const expected = toHex(await hmacSha256(secret, `${time}.${body}`))
  return signatures.some((signature) => timingSafeEqual(signature, expected))
}

function checkoutSession(session: Json): PaymentInput | null {
  const amount = number(session.amount_total)
  if (session.payment_status !== 'paid' || !amount) return null
  const details = object(session.customer_details)
  const metadata = object(session.metadata)
  const attribution = attributionFrom(metadata)
  const reference = string(session.client_reference_id)
  return compact({
    id: String(session.id),
    amount,
    currency: String(session.currency).toUpperCase(),
    email: string(details.email)?.toLowerCase(),
    name: string(details.name),
    customerId: string(session.customer),
    subscriptionId: string(session.subscription),
    // Refunds reference the payment intent, or for a subscription's first charge the invoice; store it to find
    // this payment again.
    orderId: string(session.payment_intent) ?? string(session.invoice) ?? String(session.id),
    visitorId: attribution.visitorId ?? reference,
    sessionId: attribution.sessionId,
    ts: timestamp(session.created),
  })
}

function invoice(invoice: Json): PaymentInput | null {
  const amount = number(invoice.amount_paid)
  // The first invoice of a subscription is already counted by checkout.session.completed.
  if (!amount || invoice.billing_reason === 'subscription_create') return null
  const parent = object(object(invoice.parent).subscription_details)
  const metadata = { ...object(parent.metadata), ...object(invoice.metadata) }
  return compact({
    id: String(invoice.id),
    amount,
    currency: String(invoice.currency).toUpperCase(),
    email: string(invoice.customer_email)?.toLowerCase(),
    name: string(invoice.customer_name),
    customerId: string(invoice.customer),
    subscriptionId: string(invoice.subscription) ?? string(parent.subscription),
    orderId: string(invoice.payment_intent) ?? String(invoice.id),
    renewal: invoice.billing_reason === 'subscription_cycle',
    ...attributionFrom(metadata),
    ts: timestamp(invoice.created),
  })
}

/**
 * A refund keeps Stripe's refund id when the event carries the refund list. Otherwise only the charge's running
 * total is known, which the server turns into the part not recorded yet, so each partial refund counts once.
 */
function refund(charge: Json): PaymentInput | null {
  const latest = object((object(charge.refunds).data as unknown[] | undefined)?.[0])
  const total = number(charge.amount_refunded)
  const refundId = string(latest.id)
  const amount = refundId ? number(latest.amount) : total
  if (!amount) return null
  return compact({
    id: refundId ?? `${String(charge.id)}:refund:${amount}`,
    amount,
    currency: String(charge.currency).toUpperCase(),
    kind: 'refund' as const,
    customerId: string(charge.customer),
    // The refunded payment: its invoice for subscription charges, else the payment intent checkout stored.
    orderId: string(charge.invoice) ?? string(charge.payment_intent) ?? String(charge.id),
    refundedTotal: refundId ? undefined : amount,
    ts: timestamp(latest.created) ?? timestamp(charge.created),
  })
}

/**
 * Maps a verified Stripe event to a payment: `checkout.session.completed` (and its async variant),
 * `invoice.paid` for renewals, `charge.refunded`. Other events return null.
 */
export function toPayment(event: unknown): PaymentInput | null {
  const { type, data } = object(event)
  const subject = object(object(data).object)
  switch (type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      return checkoutSession(subject)
    case 'invoice.paid':
      return invoice(subject)
    case 'charge.refunded':
      return refund(subject)
    default:
      return null
  }
}
