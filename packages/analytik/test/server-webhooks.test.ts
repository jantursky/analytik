import { afterEach, describe, expect, it, vi } from 'vitest'

import { hmacSha256, toHex } from '../src/shared/crypto'
import { WEBHOOK_RETRY, chatLine, webhookUrlProblem } from '../src/server/webhooks'
import type { Webhook } from '../src/shared/types'
import { storageKinds } from './helpers/databases'
import { CHROME, PASSWORD, type TestServer, testServer } from './helpers/server'

const URL_OK = 'https://hooks.example.com/services/T000/B000/secret-path'

interface Call {
  url: string
  init: RequestInit & { headers: Record<string, string>; body: string }
  body: Record<string, unknown>
}

describe('webhook addresses', () => {
  it('accept public https hosts only', () => {
    expect(webhookUrlProblem(URL_OK, false)).toBeNull()
    expect(webhookUrlProblem('https://hooks.example.com:443/x', false)).toBeNull()
    for (const bad of [
      'http://hooks.example.com/x',
      'https://169.254.169.254/latest',
      'https://127.0.0.1/',
      'https://[::1]/',
      'https://localhost/',
      'https://db.internal/',
      'https://printer.local/',
      'https://hooks.example.com:8443/x',
      'https://user:pass@hooks.example.com/',
      'https://0x7f.1/',
      'ftp://hooks.example.com/',
      'not a url',
      '',
      `https://hooks.example.com/${'a'.repeat(500)}`,
    ]) {
      expect(webhookUrlProblem(bad, false), bad).toEqual(expect.any(String))
    }
    expect(webhookUrlProblem(42, false)).toEqual(expect.any(String))
  })

  it('allow http and local hosts when debug is on', () => {
    expect(webhookUrlProblem('http://localhost:3000/hook', true)).toBeNull()
    expect(webhookUrlProblem('ftp://localhost/', true)).toEqual(expect.any(String))
  })
})

describe.each(storageKinds())('outbound webhooks on %s', (kind) => {
  let server: TestServer
  let siteId = ''
  let calls: Call[] = []
  let reply: () => Response | Promise<Response> = () => new Response(null, { status: 200 })

  const open = async (privacyMode = 'persistent') => {
    calls = []
    reply = () => new Response(null, { status: 200 })
    const fake = vi.fn((url: string, init: Call['init']) => {
      calls.push({
        url,
        init,
        body: JSON.parse(init.body) as Record<string, unknown>,
      })
      return Promise.resolve(reply())
    })
    server = await testServer(kind, { webhooks: { fetch: fake as unknown as typeof fetch } })
    siteId = (await server.createSite({ privacyMode })).site.id
  }
  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    await server.close()
  })

  const add = async (json: Record<string, unknown> = {}) =>
    server.adminJson<{ webhook: Webhook; secret: string }>(`/sites/${siteId}/webhooks`, {
      method: 'POST',
      json: { url: URL_OK, ...json },
    })
  /** Waits for `done` while moving the fake clock past the retry wait whenever the work is waiting on it. */
  const settle = async (done: Promise<unknown>) => {
    const state = { finished: false }
    void done.then(() => {
      state.finished = true
    })
    while (!state.finished) {
      await new Promise((resolve) => setImmediate(resolve))
      await vi.advanceTimersByTimeAsync(WEBHOOK_RETRY)
    }
  }
  /** Sends one goal and waits for the deliveries it started. */
  const goal = async (name = 'signup', p: Record<string, unknown> = { plan: 'pro' }) => {
    const deferred: Promise<unknown>[] = []
    await server.analytik.ingest({
      payload: {
        w: siteId,
        t: 'goal',
        n: name,
        u: 'https://example.com/pricing',
        p,
        m: 'persistent',
        vid: 'visitor-0001',
        sid: 'session-0001',
      },
      userAgent: CHROME,
      origin: 'https://example.com',
      defer: (work) => deferred.push(work),
    })
    await Promise.all(deferred)
  }

  it('shows the secret once and only the host afterwards', async () => {
    await open()
    const { webhook, secret } = await add({ format: 'chat', events: ['goal'] })
    expect(secret).toMatch(/^whsec_[a-z0-9]{32}$/)
    expect(webhook).toMatchObject({ host: 'hooks.example.com', format: 'chat', events: ['goal'], paused: false })
    const listed = await server.adminJson<Webhook[]>(`/sites/${siteId}/webhooks`)
    expect(listed).toHaveLength(1)
    expect(JSON.stringify(listed)).not.toContain(secret)
    expect(JSON.stringify(listed)).not.toContain('secret-path')
    expect((await (await server.admin(`/sites/${siteId}/webhooks`)).text()).includes(secret)).toBe(false)
  })

  it('refuses bad input and a sixth webhook', async () => {
    await open()
    const post = (json: Record<string, unknown>) => server.admin(`/sites/${siteId}/webhooks`, { method: 'POST', json })
    expect((await post({ url: 'https://169.254.169.254/' })).status).toBe(400)
    expect((await post({ url: URL_OK, events: ['pageview'] })).status).toBe(400)
    expect((await post({ url: URL_OK, events: [] })).status).toBe(400)
    expect((await post({ url: URL_OK, format: 'xml' })).status).toBe(400)
    for (let i = 0; i < 5; i++) expect((await post({ url: URL_OK })).status).toBe(201)
    const sixth = await post({ url: URL_OK })
    expect(sixth.status).toBe(400)
    expect(((await sixth.json()) as { error: string }).error).toContain('at most 5')
  })

  it('is admin only: a share link or no login sees nothing', async () => {
    await open()
    const { webhook } = await add()
    const { token } = await server.adminJson<{ token: string }>(`/sites/${siteId}/share-links`, {
      method: 'POST',
      json: {},
    })
    for (const [method, path] of [
      ['GET', ''],
      ['POST', ''],
      ['PATCH', `/${webhook.id}`],
      ['DELETE', `/${webhook.id}`],
      ['POST', `/${webhook.id}/test`],
    ] as const) {
      const url = `/sites/${siteId}/webhooks${path}`
      expect(
        (await server.request(`${url}?share=${token}`, { method, ...(method !== 'GET' && { body: '{}' }) })).status,
        `${method} ${url}`,
      ).toBe(401)
      expect(
        (
          await server.request(url, {
            method,
            ...(method !== 'GET' && { body: '{}' }),
            headers: { authorization: `Bearer ${token}` },
          })
        ).status,
      ).toBe(401)
      expect((await server.request(url, { method, ...(method !== 'GET' && { body: '{}' }) })).status).toBe(401)
    }
  })

  it('signs a goal so the receiver can verify it, and leaves out every personal field', async () => {
    await open()
    const { secret } = await add()
    await goal('signup', { plan: 'pro' })
    expect(calls).toHaveLength(1)
    const [call] = calls
    expect(call?.url).toBe(URL_OK)
    expect(call?.init).toMatchObject({ method: 'POST', redirect: 'manual' })
    const header = call?.init.headers['x-analytik-signature'] ?? ''
    const [, seconds, signature] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header) ?? []
    expect(Number(seconds)).toBe(Math.floor(server.now / 1000))
    const raw = call?.init.body ?? ''
    expect(toHex(await hmacSha256(secret, `${seconds}.${raw}`))).toBe(signature)
    expect(toHex(await hmacSha256(secret, `${seconds}.${raw}x`))).not.toBe(signature)
    expect(call?.init.headers['x-analytik-delivery']).toMatch(/^[a-z0-9]{20}$/)
    expect(call?.body).toMatchObject({
      type: 'goal',
      name: 'signup',
      path: '/pricing',
      props: { plan: 'pro' },
      site: { id: siteId, name: 'Example', domain: 'example.com' },
    })
    expect(call?.body).toHaveProperty('source')
    expect(raw).not.toMatch(/visitor-0001|session-0001|visitorId|sessionId|email/)
  })

  it('sends payments without email, name or visitor', async () => {
    await open()
    await add({ events: ['payment'] })
    const apiKey = (await server.rows<{ id: string }>('SELECT id FROM sites'))[0]?.id
    expect(apiKey).toBeTruthy()
    // A payment from the provider's webhook path: the API route needs the key made with the site.
    const created = await server.createSite({ privacyMode: 'persistent', domain: 'shop.example.com' })
    await server.adminJson(`/sites/${created.site.id}/webhooks`, { method: 'POST', json: { url: URL_OK } })
    const response = await server.request('/v1/payments', {
      method: 'POST',
      headers: { authorization: `Bearer ${created.apiKey}` },
      body: JSON.stringify({
        id: 'pay_1',
        amount: 1999,
        currency: 'USD',
        email: 'ann@example.com',
        name: 'Ann',
        visitorId: 'visitor-0009',
      }),
    })
    expect(response.status).toBe(200)
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    const raw = calls[0]?.init.body ?? ''
    expect(calls[0]?.body).toMatchObject({
      type: 'payment',
      id: 'pay_1',
      kind: 'payment',
      amount: 1999,
      currency: 'USD',
      provider: 'api',
    })
    expect(raw).not.toMatch(/ann@example|Ann|visitor-0009|visitorId|email|"name":"Ann"/)
    // A retried provider webhook is not announced twice.
    await server.request('/v1/payments', {
      method: 'POST',
      headers: { authorization: `Bearer ${created.apiKey}` },
      body: JSON.stringify({ id: 'pay_1', amount: 1999, currency: 'USD' }),
    })
    expect(calls).toHaveLength(1)
  })

  it('sends one line of text in chat format, under text and content', async () => {
    await open()
    await add({ format: 'chat' })
    await goal('signup')
    expect(calls[0]?.body).toEqual({
      text: 'Example: goal signup on /pricing',
      content: 'Example: goal signup on /pricing',
    })
    expect(
      chatLine({ name: 'Shop' } as never, {
        type: 'payment',
        id: 'p',
        kind: 'refund',
        amount: 500,
        currency: 'EUR',
        provider: 'stripe',
        ts: 0,
        source: null,
      }),
    ).toBe('Shop: refund of €5.00 via stripe')
  })

  it('sends only the events a webhook wants, and nothing while it is paused', async () => {
    await open()
    const { webhook } = await add({ events: ['payment'] })
    await goal()
    expect(calls).toHaveLength(0)
    await server.adminJson(`/sites/${siteId}/webhooks/${webhook.id}`, { method: 'PATCH', json: { events: ['goal'] } })
    await goal()
    expect(calls).toHaveLength(1)
    const paused = await server.adminJson<Webhook>(`/sites/${siteId}/webhooks/${webhook.id}`, {
      method: 'PATCH',
      json: { paused: true },
    })
    expect(paused.paused).toBe(true)
    await goal()
    expect(calls).toHaveLength(1)
  })

  it('does not follow a redirect and counts it as failed', async () => {
    await open()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    reply = () => new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/' } })
    await add()
    const done = goal()
    await settle(done)
    expect(calls.map((call) => call.url)).toEqual([URL_OK, URL_OK])
    vi.useRealTimers()
    const [hook] = await server.adminJson<Webhook[]>(`/sites/${siteId}/webhooks`)
    expect(hook?.lastStatus).toBe('HTTP 302')
  })

  it('tries a failing receiver once more, drops it, and logs the host without secrets', async () => {
    await open()
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    reply = () => new Response('nope', { status: 500 })
    const { secret } = await add()
    const done = goal()
    await settle(done)
    expect(calls).toHaveLength(2)
    expect(log).toHaveBeenCalledWith('analytik: webhook to hooks.example.com failed (HTTP 500)')
    expect(JSON.stringify(log.mock.calls)).not.toContain(secret)
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret-path')
    expect(await server.rows('SELECT id FROM events')).toHaveLength(1)
  })

  it('succeeds on the retry and records the status only when it changes', async () => {
    await open()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let first = true
    reply = () => {
      const failing = first
      first = false
      return new Response(null, { status: failing ? 503 : 200 })
    }
    await add()
    const done = goal()
    await settle(done)
    expect(calls).toHaveLength(2)
    vi.useRealTimers()
    const [before] = await server.adminJson<Webhook[]>(`/sites/${siteId}/webhooks`)
    expect(before?.lastStatus).toBe('ok')
    const at = before?.lastAt
    server.advance(60_000)
    await goal()
    const [after] = await server.adminJson<Webhook[]>(`/sites/${siteId}/webhooks`)
    expect(after?.lastAt).toBe(at)
  })

  it('never fails or delays the event or the response when the receiver breaks', async () => {
    await open()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await add()
    reply = () => Promise.reject(new TypeError('network down'))
    // No retry wait in this test: the route returns before the deferred delivery is done.
    const response = await server.event({
      w: siteId,
      t: 'goal',
      n: 'signup',
      u: 'https://example.com/',
      m: 'persistent',
      vid: 'visitor-0002',
      sid: 'session-0002',
    })
    expect(response.status).toBe(202)
    expect(await server.rows('SELECT id FROM events')).toHaveLength(1)
    // Let the background delivery and its one retry end before the database closes.
    await vi.waitFor(
      async () => expect((await server.adminJson<Webhook[]>(`/sites/${siteId}/webhooks`))[0]?.lastStatus).toBe('error'),
      { timeout: 4000 },
    )
  })

  it('refuses to send to an address that was written into the table by hand', async () => {
    await open()
    await add()
    await server.storage.run("UPDATE outbound_webhooks SET url = 'https://169.254.169.254/'")
    await goal()
    expect(calls).toHaveLength(0)
  })

  it('tests one webhook with one try and reports the outcome', async () => {
    await open()
    const { webhook } = await add()
    expect(await server.adminJson(`/sites/${siteId}/webhooks/${webhook.id}/test`, { method: 'POST' })).toEqual({
      ok: true,
      status: 'ok',
    })
    expect(calls[0]?.body).toMatchObject({ type: 'test' })
    reply = () => new Response(null, { status: 500 })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await server.adminJson(`/sites/${siteId}/webhooks/${webhook.id}/test`, { method: 'POST' })).toEqual({
      ok: false,
      status: 'HTTP 500',
    })
    expect(calls).toHaveLength(2)
    expect((await server.admin(`/sites/${siteId}/webhooks/nope/test`, { method: 'POST' })).status).toBe(404)
  })

  it('updates, removes and reports missing webhooks', async () => {
    await open()
    const { webhook } = await add()
    expect(
      (await server.admin(`/sites/${siteId}/webhooks/nope`, { method: 'PATCH', json: { paused: true } })).status,
    ).toBe(404)
    expect(
      (await server.admin(`/sites/${siteId}/webhooks/${webhook.id}`, { method: 'PATCH', json: { paused: 'yes' } }))
        .status,
    ).toBe(400)
    expect((await server.admin(`/sites/${siteId}/webhooks/${webhook.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await server.admin(`/sites/${siteId}/webhooks/${webhook.id}`, { method: 'DELETE' })).status).toBe(404)
  })

  it('goes with the site when it is deleted', async () => {
    await open()
    await add()
    await server.admin(`/sites/${siteId}`, { method: 'DELETE', json: { confirm: 'example.com', password: PASSWORD } })
    expect(await server.rows('SELECT id FROM outbound_webhooks')).toEqual([])
  })
})
