import { hmacSha256, timingSafeEqual, toHex } from '../shared/crypto'
import type { PaymentInput } from '../shared/types'
import { type WebhookRequest, attributionFrom, compact, number, object, string, timestamp } from './shared'

export type { WebhookRequest } from './shared'

/** Checks `X-Razorpay-Signature`: hex HMAC-SHA256 of the raw body with the webhook secret. */
export async function verify({ headers, body, secret }: WebhookRequest): Promise<boolean> {
  const signature = headers.get('x-razorpay-signature')
  if (!signature) return false
  return timingSafeEqual(signature.toLowerCase(), toHex(await hmacSha256(secret, body)))
}

/**
 * Maps a verified Razorpay event: `payment.captured` and `refund.processed`. Visitor and session ids come from
 * the payment's `notes` (Razorpay sends `[]` when there are none). Amounts are already in paise. Other events
 * return null.
 */
export function toPayment(event: unknown): PaymentInput | null {
  const { event: name, payload: rawPayload, created_at: sentAt } = object(event)
  const payload = object(rawPayload)
  if (name === 'payment.captured') {
    const payment = object(object(payload.payment).entity)
    const id = string(payment.id)
    const amount = number(payment.amount)
    if (!id || !amount) return null
    return compact({
      id,
      amount,
      currency: String(payment.currency).toUpperCase(),
      email: string(payment.email)?.toLowerCase(),
      customerId: string(payment.customer_id),
      subscriptionId: string(payment.subscription_id),
      orderId: string(payment.order_id),
      ...attributionFrom(object(payment.notes)),
      ts: timestamp(payment.created_at) ?? timestamp(sentAt),
    })
  }
  if (name === 'refund.processed') {
    const refund = object(object(payload.refund).entity)
    const payment = object(object(payload.payment).entity)
    const id = string(refund.id)
    const amount = number(refund.amount)
    if (!id || !amount) return null
    return compact({
      id,
      amount,
      currency: String(refund.currency ?? payment.currency).toUpperCase(),
      kind: 'refund' as const,
      email: string(payment.email)?.toLowerCase(),
      customerId: string(payment.customer_id),
      orderId: string(refund.payment_id),
      ts: timestamp(refund.created_at) ?? timestamp(sentAt),
    })
  }
  return null
}
