import { describe, expect, it } from 'vitest'

import * as creem from '../src/adapters/creem'
import * as gumroad from '../src/adapters/gumroad'
import * as paddle from '../src/adapters/paddle'
import * as polar from '../src/adapters/polar'
import * as razorpay from '../src/adapters/razorpay'
import { hmacSha256, toBase64, toHex } from '../src/shared/crypto'
import { START } from './helpers/server'

const seconds = Math.floor(START / 1000)

describe('razorpay', () => {
  const secret = 'rzp_secret'
  const body = '{"event":"payment.captured"}'

  it('verifies X-Razorpay-Signature', async () => {
    const headers = new Headers({ 'x-razorpay-signature': toHex(await hmacSha256(secret, body)) })
    expect(await razorpay.verify({ headers, body, secret })).toBe(true)
    expect(await razorpay.verify({ headers, body: `${body} `, secret })).toBe(false)
    expect(await razorpay.verify({ headers: new Headers(), body, secret })).toBe(false)
  })

  it('maps captured payments and processed refunds', () => {
    const payment = {
      id: 'pay_1',
      amount: 49900,
      currency: 'inr',
      email: 'Ann@Example.com',
      order_id: 'order_1',
      created_at: seconds,
      notes: { analytik_visitor_id: 'visitor-0001', analytik_session_id: 'session-0001' },
    }
    expect(razorpay.toPayment({ event: 'payment.captured', payload: { payment: { entity: payment } } })).toEqual({
      id: 'pay_1',
      amount: 49900,
      currency: 'INR',
      email: 'ann@example.com',
      orderId: 'order_1',
      visitorId: 'visitor-0001',
      sessionId: 'session-0001',
      ts: seconds * 1000,
    })
    const refund = { id: 'rfnd_1', payment_id: 'pay_1', amount: 100, currency: 'INR', created_at: seconds }
    expect(
      razorpay.toPayment({
        event: 'refund.processed',
        payload: { refund: { entity: refund }, payment: { entity: { ...payment, notes: [] } } },
      }),
    ).toMatchObject({ id: 'rfnd_1', amount: 100, kind: 'refund', orderId: 'pay_1', email: 'ann@example.com' })
  })

  it('ignores other events and empty amounts', () => {
    expect(razorpay.toPayment({ event: 'payment.failed', payload: {} })).toBeNull()
    expect(
      razorpay.toPayment({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', amount: 0 } } } }),
    ).toBeNull()
    expect(razorpay.toPayment({ event: 'refund.processed', payload: {} })).toBeNull()
    expect(razorpay.toPayment(null)).toBeNull()
  })
})

describe('paddle', () => {
  const secret = 'pdl_ntfset_secret'
  const body = '{"event_type":"transaction.completed"}'

  async function header(time = seconds, text = body) {
    return new Headers({ 'paddle-signature': `ts=${time};h1=${toHex(await hmacSha256(secret, `${time}:${text}`))}` })
  }

  it('verifies Paddle-Signature within five minutes', async () => {
    const headers = await header()
    expect(await paddle.verify({ headers, body, secret, now: START })).toBe(true)
    expect(await paddle.verify({ headers, body: `${body} `, secret, now: START })).toBe(false)
    expect(await paddle.verify({ headers, body, secret, now: START + 301_000 })).toBe(false)
    expect(await paddle.verify({ headers: new Headers(), body, secret })).toBe(false)
    expect(await paddle.verify({ headers: new Headers({ 'paddle-signature': 'h1=abc' }), body, secret })).toBe(false)
  })

  it('maps completed transactions and approved refunds', () => {
    const data = {
      id: 'txn_1',
      origin: 'subscription_recurring',
      customer_id: 'ctm_1',
      subscription_id: 'sub_1',
      currency_code: 'USD',
      billed_at: '2026-10-01T10:00:00Z',
      custom_data: { analytik_visitor_id: 'visitor-0001' },
      details: { totals: { grand_total: '4900', currency_code: 'USD' } },
    }
    expect(paddle.toPayment({ event_type: 'transaction.completed', data })).toEqual({
      id: 'txn_1',
      amount: 4900,
      currency: 'USD',
      customerId: 'ctm_1',
      subscriptionId: 'sub_1',
      renewal: true,
      visitorId: 'visitor-0001',
      ts: Date.parse('2026-10-01T10:00:00Z'),
    })
    const adjustment = {
      id: 'adj_1',
      action: 'refund',
      status: 'approved',
      transaction_id: 'txn_1',
      currency_code: 'USD',
      customer_id: 'ctm_1',
      totals: { total: '1000' },
      created_at: '2026-10-02T10:00:00Z',
    }
    expect(paddle.toPayment({ event_type: 'adjustment.updated', data: adjustment })).toMatchObject({
      id: 'adj_1',
      amount: 1000,
      kind: 'refund',
      orderId: 'txn_1',
    })
  })

  it('ignores pending adjustments, credits and other events', () => {
    expect(
      paddle.toPayment({
        event_type: 'adjustment.updated',
        data: { id: 'adj_1', action: 'refund', status: 'pending_approval' },
      }),
    ).toBeNull()
    expect(
      paddle.toPayment({
        event_type: 'adjustment.updated',
        data: { id: 'adj_1', action: 'credit', status: 'approved' },
      }),
    ).toBeNull()
    expect(
      paddle.toPayment({
        event_type: 'adjustment.updated',
        data: { id: 'adj_1', action: 'refund', status: 'approved', totals: {} },
      }),
    ).toBeNull()
    expect(
      paddle.toPayment({ event_type: 'transaction.completed', data: { id: 'txn_1', details: { totals: {} } } }),
    ).toBeNull()
    expect(paddle.toPayment({ event_type: 'transaction.created', data: { id: 'txn_1' } })).toBeNull()
    expect(paddle.toPayment({ event_type: 'transaction.completed', data: {} })).toBeNull()
  })
})

describe('polar', () => {
  const secret = 'polar_whs_secret'

  async function headers(text: string, key: string, id = 'msg_1') {
    const signature = toBase64(await hmacSha256(new TextEncoder().encode(secret), `${id}.${seconds}.${text}`))
    return new Headers({
      'webhook-id': id,
      'webhook-timestamp': String(seconds),
      'webhook-signature': `v1,${signature}`,
      key,
    })
  }

  it('verifies a Standard Webhooks signature made with the plain secret', async () => {
    const body = '{"type":"order.paid"}'
    const signed = await headers(body, 'x')
    expect(await polar.verify({ headers: signed, body, secret, now: START })).toBe(true)
    expect(await polar.verify({ headers: signed, body, secret: `whsec_${btoa(secret)}`, now: START })).toBe(true)
    expect(await polar.verify({ headers: signed, body: `${body} `, secret, now: START })).toBe(false)
    expect(await polar.verify({ headers: signed, body, secret: 'other', now: START })).toBe(false)
  })

  it('maps paid and refunded orders', () => {
    const order = {
      id: 'ord_1',
      total_amount: 2900,
      currency: 'usd',
      billing_reason: 'subscription_cycle',
      subscription_id: 'sub_1',
      customer_id: 'cus_1',
      customer: { email: 'Ann@Example.com', name: 'Ann' },
      metadata: { analytik_visitor_id: 'visitor-0001' },
      created_at: '2026-10-01T10:00:00Z',
    }
    expect(polar.toPayment({ type: 'order.paid', data: order })).toEqual({
      id: 'order_ord_1',
      amount: 2900,
      currency: 'USD',
      email: 'ann@example.com',
      name: 'Ann',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      orderId: 'ord_1',
      renewal: true,
      visitorId: 'visitor-0001',
      ts: Date.parse('2026-10-01T10:00:00Z'),
    })
    expect(polar.toPayment({ type: 'order.refunded', data: { ...order, refunded_amount: 500 } })).toMatchObject({
      id: 'order_ord_1:refund:500',
      amount: 500,
      refundedTotal: 500,
      kind: 'refund',
      orderId: 'ord_1',
    })
  })

  it('ignores other events and empty amounts', () => {
    expect(polar.toPayment({ type: 'order.created', data: { id: 'ord_1' } })).toBeNull()
    expect(polar.toPayment({ type: 'order.paid', data: { id: 'ord_1', total_amount: 0 } })).toBeNull()
    expect(polar.toPayment({ type: 'order.refunded', data: { id: 'ord_1' } })).toBeNull()
    expect(polar.toPayment({ type: 'order.paid', data: {} })).toBeNull()
  })
})

describe('creem', () => {
  const secret = 'creem_whsec'

  it('verifies creem-signature', async () => {
    const body = '{"eventType":"checkout.completed"}'
    const headers = new Headers({ 'creem-signature': toHex(await hmacSha256(secret, body)) })
    expect(await creem.verify({ headers, body, secret })).toBe(true)
    expect(await creem.verify({ headers, body: `${body} `, secret })).toBe(false)
    expect(await creem.verify({ headers: new Headers(), body, secret })).toBe(false)
  })

  it('maps checkouts, subscription invoices and refunds', () => {
    const customer = { id: 'cust_1', email: 'Ann@Example.com', name: 'Ann' }
    expect(
      creem.toPayment({
        eventType: 'checkout.completed',
        created_at: seconds * 1000,
        object: {
          id: 'ch_1',
          customer,
          subscription: { id: 'sub_1' },
          metadata: { analytik_visitor_id: 'visitor-0001' },
          order: { id: 'ord_1', transaction: 'tran_1', amount: 1900, currency: 'eur' },
        },
      }),
    ).toEqual({
      id: 'tran_1',
      amount: 1900,
      currency: 'EUR',
      email: 'ann@example.com',
      name: 'Ann',
      customerId: 'cust_1',
      subscriptionId: 'sub_1',
      orderId: 'ord_1',
      visitorId: 'visitor-0001',
      ts: seconds * 1000,
    })
    expect(
      creem.toPayment({
        eventType: 'checkout.completed',
        object: { id: 'ch_2', customer: 'cust_2', order: { id: 'ord_2', amount: 500, currency: 'USD' } },
      }),
    ).toMatchObject({ id: 'ord_2', customerId: 'cust_2' })
    expect(
      creem.toPayment({
        eventType: 'subscription.paid',
        object: {
          id: 'sub_1',
          customer,
          last_transaction_id: 'tran_2',
          last_transaction: { amount: 1900, currency: 'EUR', order: 'ord_3', created_at: seconds * 1000 },
        },
      }),
    ).toMatchObject({ id: 'tran_2', amount: 1900, subscriptionId: 'sub_1', orderId: 'ord_3' })
    expect(
      creem.toPayment({
        eventType: 'refund.created',
        object: { id: 'ref_1', refund_amount: 300, refund_currency: 'EUR', transaction: { order: 'ord_1' }, customer },
      }),
    ).toMatchObject({ id: 'ref_1', amount: 300, kind: 'refund', orderId: 'ord_1' })
  })

  it('ignores other events and empty amounts', () => {
    expect(creem.toPayment({ eventType: 'subscription.canceled', object: {} })).toBeNull()
    expect(creem.toPayment({ eventType: 'checkout.completed', object: { order: {} } })).toBeNull()
    expect(creem.toPayment({ eventType: 'subscription.paid', object: { last_transaction: {} } })).toBeNull()
    expect(creem.toPayment({ eventType: 'refund.created', object: {} })).toBeNull()
  })
})

describe('gumroad', () => {
  const secret = 'gumroad-token'

  it('compares the token in the webhook URL', async () => {
    const headers = new Headers()
    const url = 'https://a.test/api/webhooks/gumroad/site'
    expect(await gumroad.verify({ headers, body: '', secret, url: `${url}?token=${secret}` })).toBe(true)
    expect(await gumroad.verify({ headers, body: '', secret, url: `${url}?token=nope` })).toBe(false)
    expect(await gumroad.verify({ headers, body: '', secret, url })).toBe(false)
    expect(await gumroad.verify({ headers, body: '', secret })).toBe(false)
  })

  it('maps form-encoded sales and refunds', () => {
    const body = new URLSearchParams({
      sale_id: 'sale_1',
      price: '2900',
      currency: 'usd',
      email: 'Ann@Example.com',
      full_name: 'Ann',
      purchaser_id: 'p1',
      sale_timestamp: '2026-10-01T10:00:00Z',
      'url_params[analytik_visitor_id]': 'visitor-0001',
      is_recurring_charge: 'true',
      recurrence: 'monthly',
    }).toString()
    const sale = gumroad.parse(body)
    expect(gumroad.toPayment(sale)).toEqual({
      id: 'sale_1',
      amount: 2900,
      currency: 'USD',
      email: 'ann@example.com',
      name: 'Ann',
      customerId: 'p1',
      orderId: 'sale_1',
      renewal: true,
      visitorId: 'visitor-0001',
      ts: Date.parse('2026-10-01T10:00:00Z'),
    })
    expect(gumroad.toPayment({ ...(sale as object), refunded: 'true' })).toMatchObject({
      id: 'sale_1:refund',
      kind: 'refund',
      refundedTotal: 2900,
      orderId: 'sale_1',
    })
  })

  it('ignores pings without a sale', () => {
    expect(gumroad.toPayment({})).toBeNull()
    expect(gumroad.toPayment({ sale_id: 'x', price: '0' })).toBeNull()
  })
})
