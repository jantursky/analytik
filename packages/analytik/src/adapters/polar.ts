import type { PaymentInput } from '../shared/types'
import { verify as verifyStandardWebhook } from './dodo'
import { type WebhookRequest, attributionFrom, compact, number, object, string, timestamp } from './shared'

export type { WebhookRequest } from './shared'

/**
 * Checks a Standard Webhooks signature, as Polar sends. Polar signs with the base64 of your endpoint secret, so
 * pass the secret as shown in Polar (analytik encodes it); a `whsec_` secret in base64 form also works.
 */
export function verify(request: WebhookRequest): Promise<boolean> {
  const { secret } = request
  const encoded = secret.startsWith('whsec_') ? secret : `whsec_${btoa(secret)}`
  return verifyStandardWebhook({ ...request, secret: encoded })
}

/**
 * Maps a verified Polar event: `order.paid` (one-off purchases, first and recurring subscription orders) and
 * `order.refunded`. Visitor and session ids come from the checkout `metadata`. Other events return null.
 */
export function toPayment(event: unknown): PaymentInput | null {
  const { type, data: rawData } = object(event)
  const data = object(rawData)
  const id = string(data.id)
  if (!id) return null
  const customer = object(data.customer)
  const common = {
    currency: String(data.currency).toUpperCase(),
    email: string(customer.email)?.toLowerCase(),
    name: string(customer.name),
    customerId: string(data.customer_id) ?? string(customer.id),
    subscriptionId: string(data.subscription_id),
  }
  if (type === 'order.paid') {
    const amount = number(data.total_amount)
    if (!amount) return null
    return compact({
      ...common,
      id: `order_${id}`,
      amount,
      orderId: id,
      renewal: data.billing_reason === 'subscription_cycle',
      ...attributionFrom(object(data.metadata)),
      ts: timestamp(data.created_at),
    })
  }
  if (type === 'order.refunded') {
    // Polar reports the order's refunded total, not each refund; the server records the difference.
    const amount = number(data.refunded_amount)
    if (!amount) return null
    return compact({
      ...common,
      id: `order_${id}:refund:${amount}`,
      amount,
      refundedTotal: amount,
      kind: 'refund' as const,
      orderId: id,
      ts: timestamp(data.modified_at) ?? timestamp(data.created_at),
    })
  }
  return null
}
