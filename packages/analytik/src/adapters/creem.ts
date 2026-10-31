import { hmacSha256, timingSafeEqual, toHex } from '../shared/crypto'
import type { PaymentInput } from '../shared/types'
import { type WebhookRequest, attributionFrom, compact, number, object, string, timestamp } from './shared'

export type { WebhookRequest } from './shared'

/** Checks `creem-signature`: hex HMAC-SHA256 of the raw body with the webhook secret. */
export async function verify({ headers, body, secret }: WebhookRequest): Promise<boolean> {
  const signature = headers.get('creem-signature')
  if (!signature) return false
  return timingSafeEqual(signature.toLowerCase(), toHex(await hmacSha256(secret, body)))
}

/** An id that is either a string or an expanded object with an `id`. */
const idOf = (value: unknown): string | undefined => string(value) ?? string(object(value).id)

/**
 * Maps a verified Creem event: `checkout.completed`, `subscription.paid` (every paid invoice, deduplicated with the
 * checkout by transaction id) and `refund.created`. Visitor and session ids come from the checkout `metadata`.
 * Amounts are minor units. Other events return null.
 */
export function toPayment(event: unknown): PaymentInput | null {
  const { eventType: type, created_at: sentAt, object: rawObject } = object(event)
  const data = object(rawObject)
  const customer = object(data.customer)
  const base = {
    email: string(customer.email)?.toLowerCase(),
    name: string(customer.name),
    customerId: idOf(data.customer),
    subscriptionId: idOf(data.subscription),
  }
  if (type === 'checkout.completed') {
    const order = object(data.order)
    const amount = number(order.amount)
    const id = idOf(order.transaction) ?? idOf(order) ?? string(data.id)
    if (!amount || !id) return null
    return compact({
      ...base,
      id,
      amount,
      currency: String(order.currency).toUpperCase(),
      orderId: idOf(order),
      ...attributionFrom(object(data.metadata)),
      ts: timestamp(order.created_at) ?? timestamp(sentAt),
    })
  }
  if (type === 'subscription.paid') {
    const transaction = object(data.last_transaction)
    const id = string(data.last_transaction_id) ?? string(transaction.id)
    const amount = number(transaction.amount)
    if (!id || !amount) return null
    return compact({
      ...base,
      id,
      amount,
      currency: String(transaction.currency).toUpperCase(),
      subscriptionId: string(data.id),
      customerId: idOf(data.customer),
      orderId: idOf(transaction.order),
      ...attributionFrom(object(data.metadata)),
      ts: timestamp(transaction.created_at) ?? timestamp(sentAt),
    })
  }
  if (type === 'refund.created') {
    const transaction = object(data.transaction)
    const id = string(data.id)
    const amount = number(data.refund_amount)
    if (!id || !amount) return null
    return compact({
      ...base,
      id,
      amount,
      currency: String(data.refund_currency ?? transaction.currency).toUpperCase(),
      kind: 'refund' as const,
      orderId: idOf(transaction.order) ?? idOf(data.order),
      ts: timestamp(data.created_at) ?? timestamp(sentAt),
    })
  }
  return null
}
