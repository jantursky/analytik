import { hmacSha256, timingSafeEqual, toHex } from '../shared/crypto'
import type { PaymentInput } from '../shared/types'
import { type WebhookRequest, attributionFrom, compact, number, object, string, timestamp } from './shared'

export type { WebhookRequest } from './shared'

/** Checks `X-Signature`: hex HMAC-SHA256 of the raw body with the webhook signing secret. */
export async function verify({ headers, body, secret }: WebhookRequest): Promise<boolean> {
  const signature = headers.get('x-signature')
  if (!signature) return false
  return timingSafeEqual(signature.toLowerCase(), toHex(await hmacSha256(secret, body)))
}

/**
 * Maps a verified Lemon Squeezy event: `order_created`, `subscription_payment_success` (renewals; the first
 * invoice is the order itself) and `order_refunded`. Orders are stored as `order_<id>` with the order id in
 * `orderId`, so return-page claims and refunds find them. Other events return null.
 */
export function toPayment(event: unknown): PaymentInput | null {
  const { meta, data: rawData } = object(event)
  const { event_name: name, custom_data: custom } = object(meta)
  const data = object(rawData)
  const attributes = object(data.attributes)
  const id = string(data.id)
  if (!id) return null
  const common = {
    currency: String(attributes.currency).toUpperCase(),
    email: string(attributes.user_email)?.toLowerCase(),
    name: string(attributes.user_name),
    customerId: string(attributes.customer_id),
    ...attributionFrom(object(custom)),
  }
  switch (name) {
    case 'order_created': {
      const amount = number(attributes.total)
      if (!amount || attributes.status !== 'paid') return null
      return compact({ ...common, id: `order_${id}`, amount, orderId: id, ts: timestamp(attributes.created_at) })
    }
    case 'subscription_payment_success': {
      const amount = number(attributes.total)
      if (!amount || attributes.billing_reason === 'initial') return null
      return compact({
        ...common,
        id: `invoice_${id}`,
        amount,
        subscriptionId: string(attributes.subscription_id),
        renewal: attributes.billing_reason === 'renewal',
        ts: timestamp(attributes.created_at),
      })
    }
    case 'order_refunded': {
      // Lemon Squeezy reports the order's refunded total, not each refund; the server records the difference.
      const amount = number(attributes.refunded_amount) ?? number(attributes.total)
      if (!amount) return null
      return compact({
        ...common,
        id: `order_${id}:refund:${amount}`,
        amount,
        refundedTotal: amount,
        kind: 'refund' as const,
        orderId: id,
        ts: timestamp(attributes.refunded_at) ?? timestamp(attributes.updated_at),
      })
    }
    default:
      return null
  }
}
