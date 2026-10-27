import { fromBase64, hmacSha256, timingSafeEqual, toBase64 } from '../shared/crypto'
import type { PaymentInput } from '../shared/types'
import {
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
 * Checks a Standard Webhooks signature, as sent by Dodo Payments: HMAC-SHA256 over
 * `<webhook-id>.<webhook-timestamp>.<body>` keyed with the base64 secret after `whsec_`,
 * matched against any `v1,<base64>` entry of `webhook-signature`.
 */
export async function verify({ headers, body, secret, now = Date.now() }: WebhookRequest): Promise<boolean> {
  const id = headers.get('webhook-id')
  const time = headers.get('webhook-timestamp')
  const signature = headers.get('webhook-signature')
  if (!id || !time || !signature || !withinTolerance(Number(time), now)) return false
  let key: Uint8Array<ArrayBuffer>
  try {
    key = fromBase64(secret.startsWith('whsec_') ? secret.slice(6) : secret)
  } catch {
    return false
  }
  const expected = toBase64(await hmacSha256(key, `${id}.${time}.${body}`))
  return signature
    .split(' ')
    .map((entry) => entry.split(','))
    .some(([version, value]) => version === 'v1' && value !== undefined && timingSafeEqual(value, expected))
}

/** Maps a verified Dodo event: `payment.succeeded` and `refund.succeeded`. Other events return null. */
export function toPayment(event: unknown): PaymentInput | null {
  const { type, data: rawData, timestamp: sentAt } = object(event)
  const data = object(rawData)
  const customer = object(data.customer)
  const ts = timestamp(data.created_at) ?? timestamp(sentAt)
  if (type === 'payment.succeeded') {
    const amount = number(data.total_amount)
    if (!amount) return null
    const subscriptions = Array.isArray(data.subscription_ids) ? (data.subscription_ids as unknown[]) : []
    return compact({
      id: String(data.payment_id),
      amount,
      currency: String(data.currency).toUpperCase(),
      email: string(customer.email)?.toLowerCase(),
      name: string(customer.name),
      customerId: string(customer.customer_id) ?? string(data.customer_id),
      subscriptionId: string(data.subscription_id) ?? string(subscriptions[0]),
      ...attributionFrom({ ...object(customer.metadata), ...object(data.metadata) }),
      ts,
    })
  }
  if (type === 'refund.succeeded') {
    const amount = number(data.amount)
    if (!amount) return null
    return compact({
      id: string(data.refund_id) ?? `${String(data.payment_id)}:refund`,
      amount,
      currency: String(data.currency).toUpperCase(),
      kind: 'refund' as const,
      email: string(customer.email)?.toLowerCase(),
      customerId: string(customer.customer_id),
      orderId: String(data.payment_id),
      ts,
    })
  }
  return null
}
