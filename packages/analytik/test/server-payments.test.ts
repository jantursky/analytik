import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { HOUR, MINUTE } from '../src/shared/time'
import type { Payment, PrivacyMode, Site } from '../src/shared/types'
import { CHROME, IPHONE, type TestServer, testServer } from './helpers/server'

let server: TestServer
let site: Site
let apiKey: string

beforeEach(async () => {
  server = await testServer()
  ;({ site, apiKey } = await server.createSite())
})

afterEach(async () => {
  await server.close()
})

const pay = (body: unknown, key = apiKey) =>
  server.request('/v1/payments', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  })

const payJson = async (body: unknown) => (await (await pay(body)).json()) as { payment: Payment; duplicate: boolean }

const goal = (body: unknown) =>
  server.request('/v1/goals', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  })

async function setMode(mode: PrivacyMode) {
  await server.admin(`/sites/${site.id}`, { method: 'PATCH', json: { privacyMode: mode } })
}

/** A persistent-mode visit; returns the session id. */
async function visit(visitor: string, session: string, url = 'https://example.com/', referrer?: string) {
  await server.event({
    w: site.id,
    t: 'pageview',
    u: url,
    m: 'persistent',
    vid: visitor,
    sid: session,
    ...(referrer && { r: referrer }),
  })
  return session
}

describe('POST /v1/payments', () => {
  it('requires the site API key', async () => {
    expect((await pay({ id: 'p1', amount: 100, currency: 'USD' }, 'ak_wrong')).status).toBe(401)
    const missing = await server.request('/v1/payments', { method: 'POST', body: '{}' })
    expect(missing.status).toBe(401)
  })

  it('validates the body', async () => {
    for (const body of [
      null,
      { amount: 1, currency: 'USD' },
      { id: 'p', amount: 'x', currency: 'USD' },
      { id: 'p', amount: 1, currency: 'dollars' },
    ]) {
      expect((await pay(body)).status, JSON.stringify(body)).toBe(400)
    }
    const invalid = await server.request('/v1/payments', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}` },
      body: '{',
    })
    expect(invalid.status).toBe(400)
  })

  it('stores a payment once per id and reports duplicates', async () => {
    const first = await payJson({
      id: 'pay_1',
      amount: 4900,
      currency: 'usd',
      email: 'Ann@Example.com',
      ts: 1_700_000_000_000,
    })
    expect(first.duplicate).toBe(false)
    expect(first.payment).toMatchObject({
      id: 'pay_1',
      siteId: site.id,
      provider: 'api',
      amount: 4900,
      currency: 'USD',
      kind: 'payment',
      email: 'ann@example.com',
      ts: 1_700_000_000_000,
      visitorId: null,
      matchedBy: null,
      renewal: false,
    })
    const second = await payJson({ id: 'pay_1', amount: 1, currency: 'EUR' })
    expect(second).toMatchObject({ duplicate: true, payment: { amount: 4900 } })
  })

  it('rejects bodies that are not a PaymentInput', async () => {
    expect((await pay({ transaction_id: 'tx-1', amount: 29.99, currency: 'USD' })).status).toBe(400)
    expect((await pay({ id: 'tx-1', amount: '29.99', currency: 'USD' })).status).toBe(400)
    const ok = await payJson({ id: 'tx-1', amount: 2999, currency: 'usd', visitorId: 'visitor-0001' })
    expect(ok.payment).toMatchObject({ id: 'tx-1', amount: 2999, currency: 'USD', matchedBy: 'metadata' })
  })

  it('records payments from server code with recordPayment()', async () => {
    const result = await server.analytik.recordPayment({ siteId: site.id, id: 'srv-1', amount: 100, currency: 'EUR' })
    expect(result.payment).toMatchObject({ provider: 'api', amount: 100 })
    await expect(
      server.analytik.recordPayment({ siteId: 'missing-site', id: 'x', amount: 1, currency: 'EUR' }),
    ).rejects.toThrow('site not found')
  })
})

describe('payment attribution', () => {
  beforeEach(async () => {
    await setMode('persistent')
  })

  it('credits the last non-direct visit of the visitor named in the metadata', async () => {
    const tweet = await visit('visitor-0001', 'session-tweet', 'https://example.com/?ref=launch', 'https://t.co/abc')
    server.advance(2 * HOUR)
    await visit('visitor-0001', 'session-direct')
    const { payment } = await payJson({
      id: 'pay_1',
      amount: 1000,
      currency: 'USD',
      visitorId: 'visitor-0001',
      email: 'ann@x.io',
      name: 'Ann',
    })
    expect(payment).toMatchObject({ visitorId: 'visitor-0001', sessionId: tweet, matchedBy: 'metadata' })
    expect(await server.rows('SELECT email, name FROM visitors WHERE id = ?', ['visitor-0001'])).toEqual([
      { email: 'ann@x.io', name: 'Ann' },
    ])
  })

  it('falls back to the given session when the visitor has no visits', async () => {
    const { payment } = await payJson({
      id: 'pay_1',
      amount: 1000,
      currency: 'USD',
      visitorId: 'visitor-9999',
      sessionId: 'session-9999',
    })
    expect(payment).toMatchObject({ visitorId: 'visitor-9999', sessionId: 'session-9999', matchedBy: 'metadata' })
  })

  it('finds the visitor from the session when the metadata has only a session id', async () => {
    await visit('visitor-0001', 'session-0001')
    const { payment } = await payJson({ id: 'pay_1', amount: 1000, currency: 'USD', sessionId: 'session-0001' })
    expect(payment).toMatchObject({ visitorId: 'visitor-0001', sessionId: 'session-0001', matchedBy: 'metadata' })
  })

  it('links a payment to the visitor who reached the return page, before or after the webhook', async () => {
    await visit('visitor-0001', 'session-0001', 'https://example.com/thanks?payment_id=pay_early')
    const early = await payJson({ id: 'pay_early', amount: 1000, currency: 'USD' })
    expect(early.payment).toMatchObject({
      visitorId: 'visitor-0001',
      sessionId: 'session-0001',
      matchedBy: 'return_page',
    })

    const late = await payJson({ id: 'cs_late_123', amount: 2000, currency: 'USD', subscriptionId: 'sub_9' })
    expect(late.payment.visitorId).toBeNull()
    await visit('visitor-0002', 'session-0002', 'https://example.com/thanks?session_id=cs_late_123')
    const [row] = await server.rows('SELECT visitor_id, session_id, matched_by FROM payments WHERE id = ?', [
      'cs_late_123',
    ])
    expect(row).toEqual({ visitor_id: 'visitor-0002', session_id: 'session-0002', matched_by: 'return_page' })
  })

  it('matches repeat customers and marks the payment as a renewal', async () => {
    await visit('visitor-0001', 'session-0001')
    await payJson({ id: 'pay_1', amount: 1000, currency: 'USD', visitorId: 'visitor-0001', customerId: 'cus_1' })
    server.advance(HOUR)
    const { payment } = await payJson({ id: 'pay_2', amount: 1000, currency: 'USD', customerId: 'cus_1' })
    expect(payment).toMatchObject({ visitorId: 'visitor-0001', matchedBy: 'customer', renewal: true })
  })

  it('matches an email the visitor identified with', async () => {
    await visit('visitor-0001', 'session-0001')
    await server.event({
      w: site.id,
      t: 'identify',
      u: 'https://example.com/',
      m: 'persistent',
      vid: 'visitor-0001',
      sid: 'session-0001',
      p: { email: 'Ann@x.io' },
    })
    const { payment } = await payJson({ id: 'pay_1', amount: 1000, currency: 'USD', email: 'ANN@x.io' })
    expect(payment).toMatchObject({ visitorId: 'visitor-0001', matchedBy: 'email' })
  })

  it('matches by timing only when one visitor clicked through to checkout', async () => {
    await visit('visitor-0001', 'session-0001')
    await server.event({
      w: site.id,
      t: 'outbound',
      u: 'https://example.com/',
      m: 'persistent',
      vid: 'visitor-0001',
      sid: 'session-0001',
      n: 'https://checkout.stripe.com/c/pay/x',
    })
    server.advance(10 * MINUTE)
    const single = await payJson({ id: 'pay_1', amount: 1000, currency: 'USD' })
    expect(single.payment).toMatchObject({ visitorId: 'visitor-0001', matchedBy: 'timing' })

    await visit('visitor-0002', 'session-0002')
    await server.event({
      w: site.id,
      t: 'goal',
      u: 'https://example.com/',
      m: 'persistent',
      vid: 'visitor-0002',
      sid: 'session-0002',
      n: 'Checkout',
    })
    await visit('visitor-0003', 'session-0003')
    await server.event({
      w: site.id,
      t: 'goal',
      u: 'https://example.com/',
      m: 'persistent',
      vid: 'visitor-0003',
      sid: 'session-0003',
      n: 'buy-now',
    })
    server.advance(5 * MINUTE)
    const ambiguous = await payJson({ id: 'pay_2', amount: 1000, currency: 'USD' })
    expect(ambiguous.payment.visitorId).toBeNull()

    // visitor-0003 comes back from the checkout right after paying: that settles it.
    await server.event({
      w: site.id,
      t: 'pageview',
      u: 'https://example.com/welcome',
      m: 'persistent',
      vid: 'visitor-0003',
      sid: 'session-0003',
    })
    expect(await server.adminJson(`/sites/${site.id}/rematch`, { method: 'POST' })).toEqual({ checked: 1, matched: 1 })
    const [row] = await server.rows('SELECT visitor_id, matched_by FROM payments WHERE id = ?', ['pay_2'])
    expect(row).toEqual({ visitor_id: 'visitor-0003', matched_by: 'timing' })
  })

  it('never matches by timing in strict mode', async () => {
    await setMode('strict')
    await server.event({ w: site.id, t: 'goal', u: 'https://example.com/', n: 'checkout' })
    const { payment } = await payJson({ id: 'pay_1', amount: 1000, currency: 'USD' })
    expect(payment.visitorId).toBeNull()
  })

  it('stores refunds as negative amounts on the visit of their payment', async () => {
    await visit('visitor-0001', 'session-0001')
    await payJson({
      id: 'pay_1',
      amount: 1000,
      currency: 'USD',
      visitorId: 'visitor-0001',
      orderId: 'pi_1',
      customerId: 'cus_1',
    })
    const { payment } = await payJson({ id: 're_1', amount: 400, currency: 'USD', kind: 'refund', orderId: 'pi_1' })
    expect(payment).toMatchObject({
      amount: -400,
      kind: 'refund',
      visitorId: 'visitor-0001',
      sessionId: 'session-0001',
      matchedBy: 'metadata',
      customerId: 'cus_1',
    })
    const orphan = await payJson({ id: 're_2', amount: -50, currency: 'USD', kind: 'refund' })
    expect(orphan.payment).toMatchObject({ amount: -50, visitorId: null })
  })

  it('finds the payment of a refund by subscription, else by the customer latest payment', async () => {
    await visit('visitor-0001', 'session-0001')
    await payJson({ id: 'cs_1', amount: 1000, currency: 'USD', visitorId: 'visitor-0001', subscriptionId: 'sub_1' })
    const bySubscription = await payJson({
      id: 're_1',
      amount: 1000,
      currency: 'USD',
      kind: 'refund',
      orderId: 'pi_unknown',
      subscriptionId: 'sub_1',
    })
    expect(bySubscription.payment).toMatchObject({ visitorId: 'visitor-0001', sessionId: 'session-0001' })
    await payJson({ id: 'cs_2', amount: 500, currency: 'USD', visitorId: 'visitor-0001', customerId: 'cus_2' })
    const byCustomer = await payJson({
      id: 're_2',
      amount: 500,
      currency: 'USD',
      kind: 'refund',
      orderId: 'pi_other',
      customerId: 'cus_2',
    })
    expect(byCustomer.payment).toMatchObject({ visitorId: 'visitor-0001', customerId: 'cus_2' })
  })

  it('rematch links refunds together with their payment', async () => {
    await payJson({ id: 'pay_1', amount: 1000, currency: 'USD' })
    await payJson({ id: 're_1', amount: 1000, currency: 'USD', kind: 'refund', orderId: 'pay_1' })
    await visit('visitor-0001', 'session-0001')
    await server.storage.run(
      "INSERT INTO payment_claims (site_id, payment_id, visitor_id, ts) VALUES (?, 'pay_1', 'visitor-0001', 1)",
      [site.id],
    )
    expect(await server.adminJson(`/sites/${site.id}/rematch`, { method: 'POST' })).toEqual({ checked: 1, matched: 1 })
    expect(await server.rows('SELECT id, visitor_id FROM payments ORDER BY id')).toEqual([
      { id: 'pay_1', visitor_id: 'visitor-0001' },
      { id: 're_1', visitor_id: 'visitor-0001' },
    ])
  })
})

describe('POST /v1/goals', () => {
  it('records a server-side goal on the visitor latest session', async () => {
    await setMode('persistent')
    await visit('visitor-0001', 'session-0001', 'https://example.com/signup')
    const response = await goal({ name: 'signup', visitorId: 'visitor-0001', props: { plan: 'pro' } })
    expect(await response.json()).toEqual({ ok: true, visitorId: 'visitor-0001', sessionId: 'session-0001' })
    expect(await server.rows("SELECT name, path, props FROM events WHERE type = 'goal'")).toEqual([
      { name: 'signup', path: '/signup', props: '{"plan":"pro"}' },
    ])
    expect(await server.rows('SELECT goals FROM sessions')).toEqual([{ goals: 1 }])
  })

  it('finds the visitor by a server-supplied email, also in strict mode', async () => {
    await server.event({ w: site.id, t: 'pageview', u: 'https://example.com/' })
    const [{ visitor_id: visitor } = { visitor_id: '' }] = await server.rows<{ visitor_id: string }>(
      'SELECT visitor_id FROM sessions',
    )
    expect((await goal({ name: 'trial', visitorId: visitor, email: 'Bob@x.io' })).status).toBe(200)
    expect((await goal({ name: 'paid', email: 'bob@x.io' })).status).toBe(200)
    expect(await server.rows("SELECT name FROM events WHERE type = 'goal' ORDER BY ts, name")).toEqual([
      { name: 'paid' },
      { name: 'trial' },
    ])
  })

  it('validates and answers 404 for unknown visitors', async () => {
    expect((await goal({ visitorId: 'visitor-0001' })).status).toBe(400)
    expect((await goal({ name: 'x' })).status).toBe(400)
    expect((await goal({ name: 'x', visitorId: 'visitor-0404' })).status).toBe(404)
    const anonymous = await server.request('/v1/goals', { method: 'POST', body: '{}' })
    expect(anonymous.status).toBe(401)
  })
})

describe('POST /attribution', () => {
  it('returns the strict-mode ids for the caller', async () => {
    const headers = { 'user-agent': CHROME, 'cf-connecting-ip': '203.0.113.7' }
    const empty = await server.request('/attribution', {
      method: 'POST',
      headers,
      body: JSON.stringify({ w: site.id }),
    })
    expect(empty.headers.get('access-control-allow-origin')).toBe('*')
    const before = (await empty.json()) as { visitorId: string; sessionId: string | null }
    expect(before.sessionId).toBeNull()
    await server.event({ w: site.id, t: 'pageview', u: 'https://example.com/pricing' })
    const response = await server.request('/attribution', {
      method: 'POST',
      headers,
      body: JSON.stringify({ site: site.id }),
    })
    const after = (await response.json()) as { visitorId: string; sessionId: string }
    const [session] = await server.rows<{ id: string; visitor_id: string }>('SELECT id, visitor_id FROM sessions')
    expect(after).toEqual({ visitorId: session?.visitor_id, sessionId: session?.id })
    expect(before.visitorId).toBe(after.visitorId)
  })

  it('returns the tab id as session in enriched mode', async () => {
    await setMode('enriched')
    const body = JSON.stringify({ w: site.id, u: 'https://example.com/', m: 'enriched', sid: 'tab-000001' })
    const ids = (await (await server.request('/attribution', { method: 'POST', body })).json()) as { sessionId: string }
    expect(ids.sessionId).toBe('tab-000001')
  })

  it('answers 404 for unknown sites and rate limits per caller', async () => {
    expect((await server.request('/attribution', { method: 'POST', body: '{"w":"nope"}' })).status).toBe(404)
    expect((await server.request('/attribution', { method: 'POST', body: 'null' })).status).toBe(404)
    const call = () =>
      server.request('/attribution', {
        method: 'POST',
        headers: { 'user-agent': IPHONE, 'x-forwarded-for': '192.0.2.1, 10.0.0.1' },
        body: JSON.stringify({ w: site.id }),
      })
    for (let index = 0; index < 60; index++) expect((await call()).status).toBe(200)
    expect((await call()).status).toBe(429)
    server.advance(MINUTE)
    expect((await call()).status).toBe(200)
  })
})
