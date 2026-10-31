import { timingSafeEqual } from '../shared/crypto'
import type { PaymentInput } from '../shared/types'
import { type WebhookRequest, attributionFrom, compact, number, object, string, timestamp } from './shared'

export type { WebhookRequest } from './shared'

/**
 * Gumroad pings are not signed, so the webhook URL carries the secret instead: set the ping URL to
 * `.../api/webhooks/gumroad/SITE_ID?token=SECRET` and store the same SECRET in the site's settings.
 */
export function verify({ url, secret }: WebhookRequest): Promise<boolean> {
  const token = url ? new URL(url).searchParams.get('token') : null
  return Promise.resolve(token !== null && timingSafeEqual(token, secret))
}

/** Gumroad sends `application/x-www-form-urlencoded`; this turns it into the object `toPayment` reads. */
export function parse(body: string): unknown {
  const fields: Record<string, string> = {}
  for (const [key, value] of new URLSearchParams(body)) fields[key] = value
  return fields
}

/**
 * Maps a verified Gumroad sale ping. A ping with `refunded=true` becomes a refund of the sale. Visitor and session
 * ids come from the checkout link's `url_params` (`?analytik_visitor_id=...`). Prices are minor units.
 */
export function toPayment(event: unknown): PaymentInput | null {
  const sale = object(event)
  const id = string(sale.sale_id)
  const amount = number(sale.price)
  if (!id || !amount) return null
  const common = {
    currency: String(sale.currency).toUpperCase(),
    email: string(sale.email)?.toLowerCase(),
    name: string(sale.full_name),
    customerId: string(sale.purchaser_id),
    subscriptionId: string(sale.subscription_id),
    orderId: id,
    ts: timestamp(sale.sale_timestamp),
  }
  if (sale.refunded === 'true') {
    return compact({ ...common, id: `${id}:refund`, amount, kind: 'refund' as const, refundedTotal: amount })
  }
  const params = Object.fromEntries(
    Object.entries(sale)
      .map(([key, value]) => [/^url_params\[(.+)\]$/.exec(key)?.[1] ?? key, value] as const)
      .filter(([key]) => key.startsWith('analytik_') || key === 'visitor_id' || key === 'session_id'),
  )
  return compact({
    ...common,
    id,
    amount,
    renewal: sale.recurrence !== undefined && sale.is_recurring_charge === 'true',
    ...attributionFrom(params),
  })
}
