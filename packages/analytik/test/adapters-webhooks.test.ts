import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import * as dodo from '../src/adapters/dodo'
import * as lemonsqueezy from '../src/adapters/lemonsqueezy'
import * as stripe from '../src/adapters/stripe'
import { hmacSha256, toBase64, toHex } from '../src/shared/crypto'
import type { Site } from '../src/shared/types'
import { START, type TestServer, testServer } from './helpers/server'

const seconds = Math.floor(START / 1000)

async function stripeHeaders(secret: string, body: string, time = seconds) {
  const signature = toHex(await hmacSha256(secret, `${time}.${body}`))
  return new Headers({ 'stripe-signature': `t=${time},v1=deadbeef,v1=${signature}` })
}

const DODO_SECRET = `whsec_${toBase64(new TextEncoder().encode('dodo-signing-key-0123456789'))}`

async function dodoHeaders(body: string, time = seconds, id = 'msg_1') {
  const key = new TextEncoder().encode('dodo-signing-key-0123456789')
  const signature = toBase64(await hmacSha256(key, `${id}.${time}.${body}`))
  return new Headers({
    'webhook-id': id,
    'webhook-timestamp': String(time),
    'webhook-signature': `v0,xyz v1,${signature}`,
  })
}

async function lemonHeaders(secret: string, body: string) {
  return new Headers({ 'x-signature': toHex(await hmacSha256(secret, body)) })
}

describe('stripe', () => {
  const secret = 'whsec_stripe_test'

  it('verifies the Stripe-Signature header within five minutes', async () => {
    const body = '{"type":"x"}'
    const headers = await stripeHeaders(secret, body)
    expect(await stripe.verify({ headers, body, secret, now: START })).toBe(true)
    expect(await stripe.verify({ headers, body: `${body} `, secret, now: START })).toBe(false)
    expect(await stripe.verify({ headers, body, secret: 'other', now: START })).toBe(false)
    expect(await stripe.verify({ headers, body, secret, now: START + 301_000 })).toBe(false)
    expect(await stripe.verify({ headers: new Headers(), body, secret })).toBe(false)
    expect(await stripe.verify({ headers: new Headers({ 'stripe-signature': 'v1=abc' }), body, secret })).toBe(false)
  })

  it('maps completed checkouts', () => {
    const session = {
      id: 'cs_test_1',
      amount_total: 4900,
      currency: 'eur',
      payment_status: 'paid',
      customer: 'cus_1',
      customer_details: { email: 'Ann@Example.com', name: 'Ann' },
      client_reference_id: 'visitor-0001',
      metadata: { analytik_session_id: 'session-0001' },
      subscription: 'sub_1',
      payment_intent: 'pi_1',
      created: seconds,
    }
    expect(stripe.toPayment({ type: 'checkout.session.completed', data: { object: session } })).toEqual({
      id: 'cs_test_1',
      amount: 4900,
      currency: 'EUR',
      email: 'ann@example.com',
      name: 'Ann',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      orderId: 'pi_1',
      visitorId: 'visitor-0001',
      sessionId: 'session-0001',
      ts: seconds * 1000,
    })
    const unpaid = { ...session, payment_status: 'unpaid' }
    expect(stripe.toPayment({ type: 'checkout.session.async_payment_succeeded', data: { object: unpaid } })).toBeNull()
    const minimal = stripe.toPayment({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_2',
          amount_total: 100,
          currency: 'usd',
          payment_status: 'paid',
          metadata: { analytik_visitor_id: 'visitor-0007' },
        },
      },
    })
    expect(minimal).toEqual({ id: 'cs_2', amount: 100, currency: 'USD', orderId: 'cs_2', visitorId: 'visitor-0007' })
  })

  it('maps paid invoices as renewals and skips the first one', () => {
    const invoice = {
      id: 'in_1',
      amount_paid: 900,
      currency: 'usd',
      billing_reason: 'subscription_cycle',
      customer: 'cus_1',
      customer_email: 'ann@example.com',
      parent: { subscription_details: { subscription: 'sub_1', metadata: { analytik_visitor_id: 'visitor-0001' } } },
      created: seconds,
    }
    expect(stripe.toPayment({ type: 'invoice.paid', data: { object: invoice } })).toEqual({
      id: 'in_1',
      amount: 900,
      currency: 'USD',
      email: 'ann@example.com',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      orderId: 'in_1',
      renewal: true,
      visitorId: 'visitor-0001',
      ts: seconds * 1000,
    })
    const first = { ...invoice, billing_reason: 'subscription_create' }
    expect(stripe.toPayment({ type: 'invoice.paid', data: { object: first } })).toBeNull()
    expect(stripe.toPayment({ type: 'invoice.paid', data: { object: { ...invoice, amount_paid: 0 } } })).toBeNull()
  })

  it('maps refunds to the payment intent they refund', () => {
    const charge = {
      id: 'ch_1',
      amount_refunded: 4900,
      currency: 'eur',
      payment_intent: 'pi_1',
      refunds: { data: [{ id: 're_1', amount: 1000, created: seconds }] },
    }
    expect(stripe.toPayment({ type: 'charge.refunded', data: { object: charge } })).toEqual({
      id: 're_1',
      amount: 1000,
      currency: 'EUR',
      kind: 'refund',
      orderId: 'pi_1',
      ts: seconds * 1000,
    })
    const bare = { id: 'ch_2', amount_refunded: 500, currency: 'usd', created: seconds }
    expect(stripe.toPayment({ type: 'charge.refunded', data: { object: bare } })).toMatchObject({
      id: 'ch_2:refund:500',
      amount: 500,
      refundedTotal: 500,
      orderId: 'ch_2',
    })
    const subscription = { ...bare, payment_intent: 'pi_2', invoice: 'in_2' }
    expect(stripe.toPayment({ type: 'charge.refunded', data: { object: subscription } })).toMatchObject({
      orderId: 'in_2',
    })
    expect(stripe.toPayment({ type: 'charge.refunded', data: { object: { id: 'ch_3' } } })).toBeNull()
    expect(stripe.toPayment({ type: 'customer.created', data: {} })).toBeNull()
    expect(stripe.toPayment(null)).toBeNull()
  })
})

describe('dodo', () => {
  it('verifies Standard Webhooks signatures', async () => {
    const body = '{"type":"payment.succeeded"}'
    const headers = await dodoHeaders(body)
    expect(await dodo.verify({ headers, body, secret: DODO_SECRET, now: START })).toBe(true)
    expect(await dodo.verify({ headers, body, secret: DODO_SECRET.slice(6), now: START })).toBe(true)
    expect(await dodo.verify({ headers, body: '{}', secret: DODO_SECRET, now: START })).toBe(false)
    expect(await dodo.verify({ headers, body, secret: DODO_SECRET, now: START + 10 * 60_000 })).toBe(false)
    expect(await dodo.verify({ headers, body, secret: 'whsec_***not base64***', now: START })).toBe(false)
    expect(await dodo.verify({ headers: new Headers(), body, secret: DODO_SECRET })).toBe(false)
  })

  it('maps successful payments and refunds', () => {
    const payment = dodo.toPayment({
      type: 'payment.succeeded',
      timestamp: '2026-03-16T12:00:00Z',
      data: {
        payment_id: 'pay_1',
        total_amount: 2900,
        currency: 'usd',
        customer: {
          customer_id: 'cus_1',
          email: 'Bob@x.io',
          name: 'Bob',
          metadata: { analytik_visitor_id: 'visitor-0001' },
        },
        metadata: { analytik_session_id: 'session-0001' },
        subscription_ids: ['sub_1'],
      },
    })
    expect(payment).toEqual({
      id: 'pay_1',
      amount: 2900,
      currency: 'USD',
      email: 'bob@x.io',
      name: 'Bob',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      visitorId: 'visitor-0001',
      sessionId: 'session-0001',
      ts: START,
    })
    const refund = dodo.toPayment({
      type: 'refund.succeeded',
      data: {
        refund_id: 'ref_1',
        payment_id: 'pay_1',
        amount: 2900,
        currency: 'usd',
        created_at: '2026-03-17T00:00:00Z',
      },
    })
    expect(refund).toEqual({
      id: 'ref_1',
      amount: 2900,
      currency: 'USD',
      kind: 'refund',
      orderId: 'pay_1',
      ts: Date.UTC(2026, 2, 17),
    })
    expect(
      dodo.toPayment({ type: 'refund.succeeded', data: { payment_id: 'pay_2', amount: 5, currency: 'usd' } }),
    ).toMatchObject({
      id: 'pay_2:refund',
    })
    const prefixed = dodo.toPayment({
      type: 'payment.succeeded',
      data: {
        payment_id: 'p3',
        total_amount: 5,
        currency: 'usd',
        metadata: { metadata_analytik_visitor_id: 'visitor-0009', metadata_analytik_session_id: 'session-0002' },
      },
    })
    expect(prefixed).toMatchObject({ visitorId: 'visitor-0009', sessionId: 'session-0002' })
    expect(dodo.toPayment({ type: 'payment.succeeded', data: { payment_id: 'p', total_amount: 0 } })).toBeNull()
    expect(dodo.toPayment({ type: 'refund.succeeded', data: {} })).toBeNull()
    expect(dodo.toPayment({ type: 'subscription.active', data: {} })).toBeNull()
  })
})

describe('lemonsqueezy', () => {
  const secret = 'lemon-secret'

  it('verifies X-Signature', async () => {
    const body = '{"meta":{}}'
    expect(await lemonsqueezy.verify({ headers: await lemonHeaders(secret, body), body, secret })).toBe(true)
    expect(await lemonsqueezy.verify({ headers: await lemonHeaders('other', body), body, secret })).toBe(false)
    expect(await lemonsqueezy.verify({ headers: new Headers(), body, secret })).toBe(false)
  })

  it('maps orders, renewals and refunds', () => {
    const attributes = {
      currency: 'usd',
      user_email: 'Cy@x.io',
      user_name: 'Cy',
      customer_id: 7,
      total: 1900,
      status: 'paid',
      created_at: '2026-03-16T12:00:00Z',
    }
    const meta = { event_name: 'order_created', custom_data: { analytik_visitor_id: 'visitor-0001' } }
    expect(lemonsqueezy.toPayment({ meta, data: { id: '42', attributes } })).toEqual({
      id: 'order_42',
      orderId: '42',
      amount: 1900,
      currency: 'USD',
      email: 'cy@x.io',
      name: 'Cy',
      customerId: '7',
      visitorId: 'visitor-0001',
      ts: START,
    })
    expect(
      lemonsqueezy.toPayment({ meta, data: { id: '43', attributes: { ...attributes, status: 'pending' } } }),
    ).toBeNull()

    const invoice = { ...attributes, subscription_id: 9, billing_reason: 'renewal' }
    expect(
      lemonsqueezy.toPayment({
        meta: { event_name: 'subscription_payment_success' },
        data: { id: '5', attributes: invoice },
      }),
    ).toMatchObject({
      id: 'invoice_5',
      subscriptionId: '9',
      renewal: true,
    })
    const initial = { ...invoice, billing_reason: 'initial' }
    expect(
      lemonsqueezy.toPayment({
        meta: { event_name: 'subscription_payment_success' },
        data: { id: '6', attributes: initial },
      }),
    ).toBeNull()

    const refunded = { ...attributes, refunded_amount: 500, refunded_at: '2026-03-17T00:00:00Z' }
    expect(
      lemonsqueezy.toPayment({ meta: { event_name: 'order_refunded' }, data: { id: '42', attributes: refunded } }),
    ).toMatchObject({
      id: 'order_42:refund:500',
      amount: 500,
      refundedTotal: 500,
      kind: 'refund',
      orderId: '42',
      ts: Date.UTC(2026, 2, 17),
    })
    expect(
      lemonsqueezy.toPayment({ meta: { event_name: 'order_refunded' }, data: { id: '1', attributes: {} } }),
    ).toBeNull()
    expect(
      lemonsqueezy.toPayment({
        meta: { event_name: 'subscription_payment_success' },
        data: { id: '1', attributes: {} },
      }),
    ).toBeNull()
    expect(lemonsqueezy.toPayment({ meta: { event_name: 'license_key_created' }, data: { id: '1' } })).toBeNull()
    expect(lemonsqueezy.toPayment({ meta, data: {} })).toBeNull()
  })
})

describe('POST /webhooks/:provider/:siteId', () => {
  let server: TestServer
  let site: Site

  beforeEach(async () => {
    server = await testServer()
    ;({ site } = await server.createSite({ privacyMode: 'persistent' }))
    await server.admin(`/sites/${site.id}`, {
      method: 'PATCH',
      json: { webhookSecrets: { stripe: 'whsec_stripe', dodo: DODO_SECRET, lemonsqueezy: 'lemon' } },
    })
  })

  afterEach(async () => {
    await server.close()
  })

  const post = (path: string, body: string, headers: Headers) => server.request(path, { method: 'POST', body, headers })

  it('records a verified Stripe checkout and acknowledges duplicates and other events', async () => {
    await server.event({
      w: site.id,
      t: 'pageview',
      u: 'https://example.com/',
      m: 'persistent',
      vid: 'visitor-0001',
      sid: 'session-0001',
    })
    const body = JSON.stringify({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_1',
          amount_total: 4900,
          currency: 'usd',
          payment_status: 'paid',
          client_reference_id: 'visitor-0001',
          payment_intent: 'pi_1',
        },
      },
    })
    const path = `/webhooks/stripe/${site.id}`
    const first = await post(path, body, await stripeHeaders('whsec_stripe', body))
    expect(await first.json()).toEqual({ ok: true, duplicate: false })
    const again = await post(path, body, await stripeHeaders('whsec_stripe', body))
    expect(await again.json()).toEqual({ ok: true, duplicate: true })
    const refund = JSON.stringify({
      type: 'charge.refunded',
      data: { object: { id: 'ch_1', amount_refunded: 4900, currency: 'usd', payment_intent: 'pi_1' } },
    })
    await post(path, refund, await stripeHeaders('whsec_stripe', refund))
    const other = JSON.stringify({ type: 'customer.created', data: { object: {} } })
    expect(await (await post(path, other, await stripeHeaders('whsec_stripe', other))).json()).toEqual({
      ok: true,
      ignored: true,
    })
    expect(
      await server.rows(
        'SELECT id, provider, amount, visitor_id, session_id, matched_by FROM payments ORDER BY amount',
      ),
    ).toEqual([
      {
        id: 'ch_1:refund:4900',
        provider: 'stripe',
        amount: -4900,
        visitor_id: 'visitor-0001',
        session_id: 'session-0001',
        matched_by: 'metadata',
      },
      {
        id: 'cs_1',
        provider: 'stripe',
        amount: 4900,
        visitor_id: 'visitor-0001',
        session_id: 'session-0001',
        matched_by: 'metadata',
      },
    ])
  })

  const stripeEvent = async (type: string, object: Record<string, unknown>) => {
    const body = JSON.stringify({ type, data: { object } })
    const response = await post(`/webhooks/stripe/${site.id}`, body, await stripeHeaders('whsec_stripe', body))
    return (await response.json()) as { duplicate?: boolean; ignored?: boolean }
  }

  it('records a Stripe payment whose id a tracker revenue event used first, without counting it twice', async () => {
    const revenue = { w: site.id, t: 'revenue', u: 'https://example.com/thanks', a: 1, c: 'USD', o: 'cs_taken' }
    await server.event({ ...revenue, m: 'persistent', vid: 'visitor-0001', sid: 'session-0001' })
    expect(await server.rows('SELECT id, provider FROM payments')).toEqual([
      { id: 'client:cs_taken', provider: 'client' },
    ])
    const paid = { id: 'cs_taken', payment_status: 'paid', amount_total: 9900, currency: 'usd', payment_intent: 'pi_t' }
    expect(await stripeEvent('checkout.session.completed', paid)).toEqual({ ok: true, duplicate: false })
    expect(await server.rows('SELECT id, provider, amount FROM payments')).toEqual([
      { id: 'cs_taken', provider: 'stripe', amount: 9900 },
    ])
    // A revenue event arriving after the verified payment adds nothing.
    await server.event({ ...revenue, o: 'pi_t', m: 'persistent', vid: 'visitor-0001', sid: 'session-0001' })
    expect(await server.rows('SELECT id FROM payments')).toEqual([{ id: 'cs_taken' }])
  })

  it('records each partial Stripe refund once, with or without the refund list', async () => {
    await stripeEvent('checkout.session.completed', {
      id: 'cs_2',
      payment_status: 'paid',
      amount_total: 10_000,
      currency: 'usd',
      payment_intent: 'pi_2',
    })
    const charge = { id: 'ch_2', payment_intent: 'pi_2', currency: 'usd', created: seconds }
    expect(await stripeEvent('charge.refunded', { ...charge, amount_refunded: 3000 })).toMatchObject({
      duplicate: false,
    })
    expect(await stripeEvent('charge.refunded', { ...charge, amount_refunded: 3000 })).toMatchObject({
      duplicate: true,
    })
    expect(await stripeEvent('charge.refunded', { ...charge, amount_refunded: 5000 })).toMatchObject({
      duplicate: false,
    })
    const listed = { ...charge, amount_refunded: 6000, refunds: { data: [{ id: 're_3', amount: 1000 }] } }
    expect(await stripeEvent('charge.refunded', listed)).toMatchObject({ duplicate: false })
    // Out of order: the total is already covered.
    expect(await stripeEvent('charge.refunded', { ...charge, amount_refunded: 6000 })).toMatchObject({
      duplicate: true,
    })
    expect(await server.rows("SELECT id, amount FROM payments WHERE kind = 'refund' ORDER BY amount")).toEqual([
      { id: 'ch_2:refund:3000', amount: -3000 },
      { id: 'ch_2:refund:5000', amount: -2000 },
      { id: 're_3', amount: -1000 },
    ])
  })

  it('carries the visit over to the refund of a subscription first charge', async () => {
    await server.event({
      w: site.id,
      t: 'pageview',
      u: 'https://example.com/',
      m: 'persistent',
      vid: 'visitor-0001',
      sid: 'session-0001',
    })
    await stripeEvent('checkout.session.completed', {
      id: 'cs_sub',
      mode: 'subscription',
      payment_intent: null,
      subscription: 'sub_1',
      invoice: 'in_1',
      payment_status: 'paid',
      amount_total: 4900,
      currency: 'usd',
      metadata: { analytik_visitor_id: 'visitor-0001', analytik_session_id: 'session-0001' },
    })
    await stripeEvent('charge.refunded', {
      id: 'ch_sub',
      payment_intent: 'pi_first_invoice',
      invoice: 'in_1',
      amount_refunded: 4900,
      currency: 'usd',
    })
    expect(await server.rows("SELECT order_id, visitor_id, session_id FROM payments WHERE kind = 'refund'")).toEqual([
      { order_id: 'in_1', visitor_id: 'visitor-0001', session_id: 'session-0001' },
    ])
  })

  it('records a second partial Lemon Squeezy refund', async () => {
    const lemon = async (event: string, attributes: Record<string, unknown>) => {
      const body = JSON.stringify({ meta: { event_name: event }, data: { id: '77', attributes } })
      await post(`/webhooks/lemonsqueezy/${site.id}`, body, await lemonHeaders('lemon', body))
    }
    await lemon('order_created', { total: 10_000, currency: 'usd', status: 'paid' })
    await lemon('order_refunded', { total: 10_000, currency: 'usd', refunded_amount: 2000 })
    await lemon('order_refunded', { total: 10_000, currency: 'usd', refunded_amount: 5000 })
    await lemon('order_refunded', { total: 10_000, currency: 'usd', refunded_amount: 5000 })
    expect(await server.rows('SELECT id, amount FROM payments ORDER BY amount')).toEqual([
      { id: 'order_77:refund:5000', amount: -3000 },
      { id: 'order_77:refund:2000', amount: -2000 },
      { id: 'order_77', amount: 10_000 },
    ])
  })

  it('records Dodo and Lemon Squeezy payments', async () => {
    const dodoBody = JSON.stringify({
      type: 'payment.succeeded',
      data: { payment_id: 'pay_1', total_amount: 100, currency: 'usd' },
    })
    expect((await post(`/webhooks/dodo/${site.id}`, dodoBody, await dodoHeaders(dodoBody))).status).toBe(200)
    const lemonBody = JSON.stringify({
      meta: { event_name: 'order_created' },
      data: { id: '1', attributes: { total: 200, currency: 'usd', status: 'paid' } },
    })
    expect(
      (await post(`/webhooks/lemonsqueezy/${site.id}`, lemonBody, await lemonHeaders('lemon', lemonBody))).status,
    ).toBe(200)
    expect(await server.rows('SELECT provider, amount FROM payments ORDER BY amount')).toEqual([
      { provider: 'dodo', amount: 100 },
      { provider: 'lemonsqueezy', amount: 200 },
    ])
  })

  it('rejects unknown providers and sites, missing secrets, bad signatures and bad bodies', async () => {
    const body = '{}'
    const headers = await stripeHeaders('whsec_stripe', body)
    expect((await post(`/webhooks/paypal/${site.id}`, body, headers)).status).toBe(404)
    expect((await post(`/webhooks/constructor/${site.id}`, body, headers)).status).toBe(404)
    expect((await post('/webhooks/stripe/unknown-site', body, headers)).status).toBe(404)
    expect((await post(`/webhooks/stripe/${site.id}`, body, await stripeHeaders('wrong', body))).status).toBe(401)
    const notJson = 'not json'
    expect(
      (await post(`/webhooks/stripe/${site.id}`, notJson, await stripeHeaders('whsec_stripe', notJson))).status,
    ).toBe(400)
    const huge = 'x'.repeat(600_000)
    expect((await post(`/webhooks/stripe/${site.id}`, huge, headers)).status).toBe(413)
    await server.admin(`/sites/${site.id}`, { method: 'PATCH', json: { webhookSecrets: { stripe: null } } })
    expect((await post(`/webhooks/stripe/${site.id}`, body, headers)).status).toBe(400)
  })
})
