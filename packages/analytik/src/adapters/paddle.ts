import { hmacSha256, timingSafeEqual, toHex } from '../shared/crypto'
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

/** Checks `Paddle-Signature` (`ts=<unix>;h1=<hex>`): HMAC-SHA256 of `<ts>:<body>` with the endpoint secret. */
export async function verify({ headers, body, secret, now = Date.now() }: WebhookRequest): Promise<boolean> {
  const header = headers.get('paddle-signature')
  if (!header) return false
  const parts = header.split(';').map((part) => part.split('='))
  const time = parts.find(([key]) => key === 'ts')?.[1]
  if (!time || !withinTolerance(Number(time), now)) return false
  const expected = toHex(await hmacSha256(secret, `${time}:${body}`))
  return parts.some(([key, value]) => key === 'h1' && value !== undefined && timingSafeEqual(value, expected))
}

/**
 * Maps a verified Paddle Billing event: `transaction.completed` and `adjustment.updated` for approved refunds.
 * Visitor and session ids come from the checkout's `customData`. Paddle sends no email on these events, only a
 * customer id. Other events return null.
 */
export function toPayment(event: unknown): PaymentInput | null {
  const { event_type: type, data: rawData, occurred_at: sentAt } = object(event)
  const data = object(rawData)
  const id = string(data.id)
  if (!id) return null
  if (type === 'transaction.completed') {
    const totals = object(object(data.details).totals)
    const amount = number(totals.grand_total)
    if (!amount) return null
    return compact({
      id,
      amount,
      currency: String(totals.currency_code ?? data.currency_code).toUpperCase(),
      customerId: string(data.customer_id),
      subscriptionId: string(data.subscription_id),
      renewal: data.origin === 'subscription_recurring',
      ...attributionFrom(object(data.custom_data)),
      ts: timestamp(data.billed_at) ?? timestamp(data.created_at) ?? timestamp(sentAt),
    })
  }
  if (type === 'adjustment.updated' && data.action === 'refund' && data.status === 'approved') {
    const amount = number(object(data.totals).total)
    if (!amount) return null
    return compact({
      id,
      amount,
      currency: String(data.currency_code).toUpperCase(),
      kind: 'refund' as const,
      customerId: string(data.customer_id),
      orderId: string(data.transaction_id),
      ts: timestamp(data.created_at) ?? timestamp(sentAt),
    })
  }
  return null
}
