import { afterEach, describe, expect, it, vi } from 'vitest'

import { cloudflareSender, encodeSubject, httpSender, mimeMessage, resendSender } from '../src/server/email/senders'
import type { EmailMessage } from '../src/server/email/types'
import { DAY, HOUR } from '../src/shared/time'
import type { EmailSettings } from '../src/server/types'
import type { Overview } from '../src/shared/types'
import { START, type TestServer, testServer } from './helpers/server'

const MESSAGE: EmailMessage = {
  from: 'Analytik <analytik@example.com>',
  to: 'me@example.com',
  subject: 'Héllo',
  text: 'plain',
  html: '<p>html</p>',
}

describe('senders', () => {
  it('posts to the Resend API with the key', async () => {
    const fetcher = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })))
    await resendSender({ apiKey: 're_123', fetch: fetcher })(MESSAGE)
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.resend.com/emails')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer re_123')
    expect(JSON.parse(init.body as string)).toEqual({
      from: MESSAGE.from,
      to: ['me@example.com'],
      subject: 'Héllo',
      text: 'plain',
      html: '<p>html</p>',
    })
  })

  it('posts the message as JSON to any HTTP API, or the shape the mapper returns', async () => {
    const fetcher = vi.fn(() => Promise.resolve(new Response('', { status: 202 })))
    await httpSender({ url: 'https://mail.test/send', headers: { 'x-key': 'k' }, fetch: fetcher })(MESSAGE)
    await httpSender({ url: 'https://mail.test/send', body: (m) => ({ To: m.to }), fetch: fetcher })(MESSAGE)
    const calls = fetcher.mock.calls as unknown as [string, RequestInit][]
    expect(JSON.parse(calls[0]![1].body as string)).toEqual(MESSAGE)
    expect((calls[0]![1].headers as Record<string, string>)['x-key']).toBe('k')
    expect(JSON.parse(calls[1]![1].body as string)).toEqual({ To: 'me@example.com' })
  })

  it('throws the API status and reason on a refusal', async () => {
    const fetcher = () => Promise.resolve(new Response('{"message":"domain not verified"}', { status: 403 }))
    await expect(resendSender({ apiKey: 'k', fetch: fetcher })(MESSAGE)).rejects.toThrow(
      'email API answered 403: {"message":"domain not verified"}',
    )
    await expect(
      httpSender({ url: 'https://mail.test', fetch: () => Promise.resolve(new Response('', { status: 500 })) })(
        MESSAGE,
      ),
    ).rejects.toThrow('email API answered 500')
  })

  it('hands the Cloudflare binding a MIME message with the bare addresses', async () => {
    const sent: unknown[] = []
    class FakeMessage {
      constructor(
        readonly from: string,
        readonly to: string,
        readonly raw: string,
      ) {}
    }
    await cloudflareSender({ send: (m) => Promise.resolve(void sent.push(m)) }, FakeMessage)(MESSAGE)
    const [message] = sent as FakeMessage[]
    expect(message).toMatchObject({ from: 'analytik@example.com', to: 'me@example.com' })
    expect(message!.raw).toContain('From: Analytik <analytik@example.com>')
    expect(message!.raw).toContain('Content-Type: multipart/alternative')
    expect(message!.raw).toContain(
      `Subject: =?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode('Héllo')))}?=`,
    )
    expect(message!.raw).toContain(btoa('<p>html</p>'))
  })
})

interface Mail {
  inbox: EmailMessage[]
  fail: { error?: Error }
}

async function emailServer(settings: Partial<EmailSettings> = {}, extra: { cronSecret?: string; to?: string } = {}) {
  const mail: Mail = { inbox: [], fail: {} }
  const server = await testServer('memory', {
    email: {
      from: 'analytik@example.com',
      cronSecret: extra.cronSecret,
      to: extra.to,
      send: (message) => {
        if (mail.fail.error) return Promise.reject(mail.fail.error)
        mail.inbox.push(message)
        return Promise.resolve()
      },
    },
  })
  if (Object.keys(settings).length > 0) {
    await server.adminJson('/email', { method: 'PUT', json: { to: 'owner@example.com', ...settings } })
  }
  return { server, mail }
}

let current: TestServer | undefined
afterEach(async () => {
  await current?.close()
  current = undefined
  vi.restoreAllMocks()
})

async function setup(settings: Partial<EmailSettings> = {}, extra: { cronSecret?: string; to?: string } = {}) {
  const result = await emailServer(settings, extra)
  current = result.server
  const { server } = result
  const { site, apiKey } = await server.createSite({ timezone: 'UTC', currency: 'EUR' })
  const pay = (body: Record<string, unknown>) =>
    server.request('/v1/payments', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    })
  const visit = (path = '/', referrer?: string) =>
    server.event({ w: site.id, t: 'pageview', u: `https://example.com${path}`, ...(referrer && { r: referrer }) })
  return { ...result, site, apiKey, pay, visit }
}

describe('off unless configured', () => {
  it('sends nothing and says so without a sender', async () => {
    const server = await testServer()
    current = server
    const { site, apiKey } = await server.createSite()
    expect(await server.adminJson('/email')).toMatchObject({ configured: false, settings: { summary: 'off' } })
    const paid = await server.request('/v1/payments', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ id: 'p1', amount: 100, currency: 'EUR' }),
    })
    expect(paid.status).toBe(200)
    expect(site.id).toBeTruthy()
    expect(await server.analytik.scheduled()).toEqual({ summary: null, down: [] })
    const test = await server.admin('/email/test', { method: 'POST', json: { to: 'a@b.co' } })
    expect(test.status).toBe(400)
  })

  it('sends nothing until something is enabled and an address is set', async () => {
    const { server, mail, pay } = await setup()
    await pay({ id: 'p1', amount: 100, currency: 'EUR' })
    server.now += 2 * DAY
    await server.analytik.scheduled()
    expect(mail.inbox).toEqual([])
  })

  it('needs an admin to read or change the settings', async () => {
    const { server } = await setup()
    expect((await server.request('/email')).status).toBe(401)
    expect((await server.request('/email', { method: 'PUT', body: '{}' })).status).toBe(401)
    expect((await server.request('/email/test', { method: 'POST', body: '{}' })).status).toBe(401)
  })
})

describe('settings', () => {
  it('saves valid fields, drops unknown ones and rejects bad values', async () => {
    const { server } = await setup()
    const saved = await server.adminJson<EmailSettings>('/email', {
      method: 'PUT',
      json: { to: 'me@example.com', payments: true, summary: 'weekly', hour: 7, timezone: 'Europe/Bratislava', x: 1 },
    })
    expect(saved).toEqual({
      to: 'me@example.com',
      payments: true,
      summary: 'weekly',
      hour: 7,
      down: false,
      timezone: 'Europe/Bratislava',
    })
    // A partial save keeps the rest.
    await server.adminJson('/email', { method: 'PUT', json: { down: true } })
    expect(await server.adminJson('/email')).toMatchObject({ settings: { summary: 'weekly', down: true, hour: 7 } })
    for (const bad of [{ to: 'nope' }, { summary: 'hourly' }, { hour: 24 }, { hour: 1.5 }, { timezone: 'Mars/Base' }]) {
      expect((await server.admin('/email', { method: 'PUT', json: bad })).status).toBe(400)
    }
  })

  it('uses the sender option as the recipient until one is chosen', async () => {
    const { server, mail, pay } = await setup({ payments: true, to: '' }, { to: 'fallback@example.com' })
    await pay({ id: 'p1', amount: 100, currency: 'EUR' })
    expect(mail.inbox.map((m) => m.to)).toEqual(['fallback@example.com'])
    expect(await server.adminJson('/email')).toMatchObject({ to: 'fallback@example.com' })
  })
})

describe('test email', () => {
  it('sends to the given or saved address and reports the sender error', async () => {
    const { server, mail } = await setup({ to: 'saved@example.com' })
    expect(await server.adminJson('/email/test', { method: 'POST', json: { to: 'draft@example.com' } })).toEqual({
      ok: true,
      to: 'draft@example.com',
    })
    await server.adminJson('/email/test', { method: 'POST', json: {} })
    expect(mail.inbox.map((m) => m.to)).toEqual(['draft@example.com', 'saved@example.com'])
    mail.fail.error = new Error('domain not verified')
    const failed = await server.admin('/email/test', { method: 'POST', json: {} })
    expect(failed.status).toBe(502)
    expect(await failed.json()).toEqual({ error: 'domain not verified' })
    const bad = await server.admin('/email/test', { method: 'POST', json: { to: 'nope' } })
    expect(bad.status).toBe(400)
  })
})

describe('payment alert', () => {
  it('emails once per new payment with the amount and source, not for retries or refunds', async () => {
    const { server, mail, pay, site } = await setup({ payments: true })
    await server.admin(`/sites/${site.id}`, { method: 'PATCH', json: { privacyMode: 'persistent' } })
    await server.event({
      w: site.id,
      t: 'pageview',
      u: 'https://example.com/',
      m: 'persistent',
      vid: 'visitor-0001',
      sid: 'session-0001',
      r: 'https://news.ycombinator.com/item?id=1',
    })
    const body = { id: 'pay_1', amount: 4900, currency: 'EUR', visitorId: 'visitor-0001', email: 'buyer@example.com' }
    expect((await pay(body)).status).toBe(200)
    expect((await pay(body)).status).toBe(200)
    expect(mail.inbox).toHaveLength(1)
    const [mailed] = mail.inbox
    expect(mailed).toMatchObject({ from: 'analytik@example.com', to: 'owner@example.com' })
    expect(mailed!.subject).toBe('New payment of €49.00 on Example')
    expect(mailed!.text).toContain('Amount: €49.00')
    expect(mailed!.text).toContain('Source: Hacker News')
    expect(mailed!.html).toContain('€49.00')

    await pay({ id: 're_1', kind: 'refund', amount: 4900, currency: 'EUR', orderId: 'pay_1' })
    expect(mail.inbox).toHaveLength(1)
  })

  it('never fails the webhook when the sender breaks, and logs it', async () => {
    const { mail, pay } = await setup({ payments: true })
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mail.fail.error = new Error('boom')
    const response = await pay({ id: 'p1', amount: 100, currency: 'USD' })
    expect(response.status).toBe(200)
    expect(log).toHaveBeenCalled()
    // The payment is stored and a retry of the webhook does not email.
    mail.fail.error = undefined
    await pay({ id: 'p1', amount: 100, currency: 'USD' })
    expect(mail.inbox).toEqual([])
  })

  it('does not hold the webhook for a sender that never answers', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const ctxSend = vi.fn(() => new Promise<void>(() => undefined))
    // Swap in a hanging sender through a second server sharing nothing: the first one proves the happy path above.
    const hanging = await testServer('memory', {
      email: { from: 'a@example.com', send: ctxSend, to: 'me@example.com' },
    })
    try {
      await hanging.adminJson('/email', { method: 'PUT', json: { payments: true } })
      const { apiKey } = await hanging.createSite({ currency: 'EUR' })
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const response = Promise.resolve(
        hanging.request('/v1/payments', {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ id: 'p1', amount: 100, currency: 'EUR' }),
        }),
      )
      const state = { answered: false }
      void response.then(() => {
        state.answered = true
      })
      // The request does real storage work before it arms the send timeout, so wait on the clock, not on a tick count.
      const deadline = performance.now() + 15_000
      while (!state.answered && performance.now() < deadline) {
        await vi.advanceTimersByTimeAsync(1000)
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
      expect(state.answered).toBe(true)
      expect((await response).status).toBe(200)
      expect(ctxSend).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
      await hanging.close()
    }
  })

  it('does not alert on browser-reported revenue', async () => {
    const { server, mail, pay, site } = await setup({ payments: true })
    const revenue = { w: site.id, t: 'revenue', u: 'https://example.com/thanks', a: 1, c: 'EUR', o: 'order-1' }
    expect((await server.event(revenue)).status).toBe(202)
    expect(mail.inbox).toEqual([])
    // The provider's own record of the order does alert.
    await pay({ id: 'pi_1', orderId: 'order-1', amount: 100, currency: 'EUR' })
    expect(mail.inbox).toHaveLength(1)
  })

  it('stays quiet when payment alerts are off', async () => {
    const { mail, pay } = await setup({ payments: false, summary: 'daily' })
    await pay({ id: 'p1', amount: 100, currency: 'USD' })
    expect(mail.inbox).toEqual([])
  })
})

describe('summary', () => {
  // START is Monday 2026-03-16 12:00 UTC.
  const sunday = Date.UTC(2026, 2, 15, 10)

  async function withYesterday(settings: Partial<EmailSettings>) {
    const context = await setup({ summary: 'daily', hour: 8, ...settings })
    const { server, pay, visit } = context
    server.now = sunday
    await visit('/pricing', 'https://news.ycombinator.com/')
    await visit('/pricing')
    await pay({ id: 'p1', amount: 2500, currency: 'EUR', ts: sunday + HOUR })
    server.now = START
    return context
  }

  it('sends one daily summary after the chosen hour with the numbers the dashboard shows', async () => {
    const { server, mail, site } = await withYesterday({})
    const first = await server.analytik.scheduled({ url: 'https://analytics.example.com' })
    expect(first).toEqual({ summary: 'daily', down: [] })
    expect(mail.inbox).toHaveLength(1)
    const [summary] = mail.inbox
    expect(summary!.subject).toBe('Your daily analytik summary, 2026-03-15')
    expect(summary!.text).toContain('Example (example.com)')
    expect(summary!.text).toContain('Revenue: €25.00 (new)')
    expect(summary!.text).toContain('Top pages')
    expect(summary!.text).toContain('/pricing: 2 views')
    expect(summary!.text).toContain('Open the dashboard: https://analytics.example.com')
    expect(summary!.html).toContain('href="https://analytics.example.com"')

    const overview = await server.adminJson<Overview>(`/sites/${site.id}/overview?from=2026-03-15&to=2026-03-15&tz=UTC`)
    expect(summary!.text).toContain(`Visitors: ${overview.visitors.value} (new)`)
    expect(summary!.text).toContain('Conversion rate: ')

    // The same period again, even from another call, sends nothing.
    expect(await server.analytik.scheduled()).toEqual({ summary: null, down: [] })
    expect(mail.inbox).toHaveLength(1)
  })

  it('waits for the chosen hour and sends the next period the next day', async () => {
    const { server, mail } = await withYesterday({ hour: 14 })
    expect((await server.analytik.scheduled()).summary).toBeNull()
    server.now = Date.UTC(2026, 2, 16, 14, 30)
    expect((await server.analytik.scheduled()).summary).toBe('daily')
    server.now = Date.UTC(2026, 2, 17, 13)
    expect((await server.analytik.scheduled()).summary).toBeNull()
    server.now = Date.UTC(2026, 2, 17, 14)
    expect((await server.analytik.scheduled()).summary).toBe('daily')
    expect(mail.inbox.map((m) => m.subject)).toEqual([
      'Your daily analytik summary, 2026-03-15',
      'Your daily analytik summary, 2026-03-16',
    ])
  })

  it('reads the hour and period in the owner time zone', async () => {
    const { server, mail } = await withYesterday({ timezone: 'Asia/Tokyo', hour: 21 })
    // 12:00 UTC is 21:00 in Tokyo on the 16th: due, and the period is the 15th in Tokyo (15th 00:00 JST).
    expect((await server.analytik.scheduled()).summary).toBe('daily')
    expect(mail.inbox[0]!.subject).toBe('Your daily analytik summary, 2026-03-15')
  })

  it('sends the weekly summary once for the week, covering the last Monday to Sunday', async () => {
    const { server, mail } = await withYesterday({ summary: 'weekly' })
    expect((await server.analytik.scheduled()).summary).toBe('weekly')
    expect(mail.inbox[0]!.subject).toBe('Your weekly analytik summary, 2026-03-09 to 2026-03-15')
    server.now = START + 3 * DAY
    expect((await server.analytik.scheduled()).summary).toBeNull()
    server.now = START + 7 * DAY
    expect((await server.analytik.scheduled()).summary).toBe('weekly')
    expect(mail.inbox).toHaveLength(2)
  })

  it('lets only one of two overlapping runs send, and retries after a failed send', async () => {
    const { server, mail } = await withYesterday({})
    const [a, b] = await Promise.all([server.analytik.scheduled(), server.analytik.scheduled()])
    expect([a.summary, b.summary].filter(Boolean)).toHaveLength(1)
    expect(mail.inbox).toHaveLength(1)

    server.now = START + DAY
    mail.fail.error = new Error('down')
    await expect(server.analytik.scheduled()).rejects.toThrow('down')
    mail.fail.error = undefined
    expect((await server.analytik.scheduled()).summary).toBe('daily')
    expect(mail.inbox).toHaveLength(2)
  })

  it('is off when set to off', async () => {
    const { server, mail } = await withYesterday({ summary: 'off' })
    expect((await server.analytik.scheduled()).summary).toBeNull()
    expect(mail.inbox).toEqual([])
  })

  it('escapes site names in the HTML', async () => {
    const { server, mail } = await setup({ summary: 'daily', hour: 0 })
    await server.adminJson('/sites', { method: 'POST', json: { name: '<b>Shop</b> & Co', domain: 'shop.example.com' } })
    await server.analytik.scheduled()
    const html = mail.inbox[0]!.html
    expect(html).toContain('&lt;b&gt;Shop&lt;/b&gt; &amp; Co')
    expect(html).not.toContain('<b>Shop</b>')
  })
})

describe('tracker-down alert', () => {
  it('alerts once per outage for a site that had traffic', async () => {
    const { server, mail, site, visit } = await setup({ down: true })
    await visit('/')
    server.now += 23 * HOUR
    expect((await server.analytik.scheduled()).down).toEqual([])
    server.now += 2 * HOUR
    expect((await server.analytik.scheduled()).down).toEqual([site.id])
    expect(mail.inbox).toHaveLength(1)
    expect(mail.inbox[0]!.subject).toBe('No events on Example for 24 hours')
    expect(mail.inbox[0]!.text).toContain('example.com')
    // Still silent: no second alert.
    server.now += 3 * HOUR
    expect((await server.analytik.scheduled()).down).toEqual([])

    // Events resume and stop again: a new outage.
    await visit('/again')
    server.now += 25 * HOUR
    expect((await server.analytik.scheduled()).down).toEqual([site.id])
    expect(mail.inbox).toHaveLength(2)
  })

  it('ignores sites without events, long quiet sites and paused sites', async () => {
    const { server, mail, site, visit } = await setup({ down: true })
    await server.adminJson('/sites', { method: 'POST', json: { name: 'Empty', domain: 'empty.example.com' } })
    server.now += 2 * DAY
    expect((await server.analytik.scheduled()).down).toEqual([])
    await visit('/')
    server.now += 9 * DAY
    expect((await server.analytik.scheduled()).down).toEqual([])
    server.now -= 9 * DAY - 2 * DAY
    await server.admin(`/sites/${site.id}`, { method: 'PATCH', json: { paused: true } })
    expect((await server.analytik.scheduled()).down).toEqual([])
    expect(mail.inbox).toEqual([])
  })

  it('is off unless enabled', async () => {
    const { server, mail, visit } = await setup({ down: false, payments: true })
    await visit('/')
    server.now += 2 * DAY
    await server.analytik.scheduled()
    expect(mail.inbox).toEqual([])
  })
})

describe('POST /v1/cron', () => {
  const call = (server: TestServer, method: string, secret?: string) =>
    server.request('/v1/cron', { method, headers: secret ? { authorization: `Bearer ${secret}` } : {} })

  it('rejects a wrong or missing secret and sends nothing', async () => {
    const { server, mail, visit } = await setup({ down: true }, { cronSecret: 'cron-secret-value' })
    await visit('/')
    server.now += 2 * DAY
    expect((await call(server, 'POST')).status).toBe(401)
    expect((await call(server, 'POST', 'wrong')).status).toBe(401)
    expect((await call(server, 'POST', 'cron-secret-value-longer')).status).toBe(401)
    expect(mail.inbox).toEqual([])
  })

  it('is closed when no secret is configured', async () => {
    const { server } = await setup({ down: true })
    expect((await call(server, 'POST', 'anything')).status).toBe(401)
    expect((await call(server, 'POST')).status).toBe(401)
  })

  it('runs the scheduled work with the right secret, by POST or the GET Vercel Cron makes', async () => {
    const { server, mail, site, visit } = await setup(
      { down: true, summary: 'daily', hour: 0 },
      { cronSecret: 's3cret' },
    )
    await visit('/')
    server.now += 2 * DAY
    const response = await call(server, 'POST', 's3cret')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, summary: 'daily', down: [site.id] })
    expect(mail.inbox).toHaveLength(2)
    expect(mail.inbox.find((m) => m.subject.startsWith('Your daily'))!.text).toContain(
      'Open the dashboard: https://analytics.example.com',
    )
    expect(await (await call(server, 'GET', 's3cret')).json()).toEqual({ ok: true, summary: null, down: [] })
  })

  it('does not put secrets into the emails', async () => {
    const { server, mail, visit } = await setup({ down: true, summary: 'daily', hour: 0 }, { cronSecret: 's3cret-xyz' })
    await visit('/')
    server.now += 2 * DAY
    await call(server, 'POST', 's3cret-xyz')
    for (const message of mail.inbox) {
      expect(message.text + message.html).not.toContain('s3cret-xyz')
    }
  })
})

describe('subject and headers', () => {
  it('keeps a short ASCII subject and splits a long or non-ASCII one into encoded words of at most 75 characters', () => {
    expect(encodeSubject('New payment of $49.00 on Shop')).toBe('New payment of $49.00 on Shop')
    const long = encodeSubject(`No events on ${'Příliš žluťoučký kůň '.repeat(6)}for 24 hours`)
    const words = long.split('\r\n ')
    expect(words.length).toBeGreaterThan(1)
    for (const word of words) {
      expect(word).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/)
      expect(word.length).toBeLessThanOrEqual(75)
    }
    const decoded = words.map((word) => atob(word.slice(10, -2))).join('')
    expect(new TextDecoder().decode(Uint8Array.from(decoded, (c) => c.charCodeAt(0)))).toContain('Příliš žluťoučký kůň')
  })

  it('cannot be given extra headers through the addresses', () => {
    const raw = mimeMessage({ ...MESSAGE, to: 'a@b.co\r\nBcc: evil@example.com' }, 'id', new Date(0))
    expect(raw).not.toMatch(/^Bcc:/m)
  })
})

describe('settings types', () => {
  it('rejects wrongly typed fields instead of ignoring them', async () => {
    const { server } = await setup()
    for (const bad of [{ payments: 'true' }, { down: 1 }, { to: 123 }]) {
      expect((await server.admin('/email', { method: 'PUT', json: bad })).status).toBe(400)
    }
    expect(await server.adminJson('/email')).toMatchObject({ settings: { payments: false, down: false, to: '' } })
  })
})

describe('abandoned and partial work', () => {
  it('takes over a reservation left by a run that died, but not one still being sent or already sent', async () => {
    const { server, mail } = await setup({ down: true })
    await server.event({
      w: (await server.storage.query<{ id: string }>('SELECT id FROM sites'))[0]!.id,
      t: 'pageview',
      u: 'https://example.com/',
    })
    server.now += 2 * DAY
    const last = (await server.storage.query<{ last: number }>('SELECT MAX(ts) AS last FROM events'))[0]!.last
    const id = (await server.storage.query<{ id: string }>('SELECT id FROM sites'))[0]!.id
    const key = `down:${id}:${last}`
    await server.storage.run("INSERT INTO notification_log (key, sent_at, status) VALUES (?, ?, 'sending')", [
      key,
      server.now,
    ])
    expect((await server.analytik.scheduled()).down).toEqual([])
    server.now += 11 * 60_000
    expect((await server.analytik.scheduled()).down).toEqual([id])
    expect(mail.inbox).toHaveLength(1)
    server.now += 60 * 60_000
    expect((await server.analytik.scheduled()).down).toEqual([])
  })

  it('reports only outages that began after the alert was switched on', async () => {
    const { server, mail, site, visit } = await setup()
    await visit('/')
    server.now += 3 * DAY
    await server.adminJson('/email', { method: 'PUT', json: { to: 'owner@example.com', down: true } })
    expect((await server.analytik.scheduled()).down).toEqual([])
    // A site that goes quiet after it was switched on is reported.
    await visit('/again')
    server.now += 25 * HOUR
    expect((await server.analytik.scheduled()).down).toEqual([site.id])
    expect(mail.inbox).toHaveLength(1)
  })

  it('reports what was sent when something failed, and keeps alerting the other sites', async () => {
    const { server, mail, site, visit } = await setup(
      { down: true, summary: 'daily', hour: 0 },
      { cronSecret: 'cron-secret' },
    )
    await visit('/')
    const other = await server.createSite({ name: 'Other', domain: 'other.example.com' })
    await server.event(
      { w: other.site.id, t: 'pageview', u: 'https://other.example.com/' },
      { origin: 'https://other.example.com' },
    )
    server.now += 2 * DAY
    const real = mail.fail
    // The summary goes out, then the first down alert is refused and the second still goes out.
    let sends = 0
    const inbox = mail.inbox
    real.error = undefined
    const refused = new Error('refused')
    const originalPush = inbox.push.bind(inbox)
    inbox.push = (...items) => {
      sends++
      if (sends === 2) {
        throw refused
      }
      return originalPush(...items)
    }
    const response = await server.request('/v1/cron', {
      method: 'POST',
      headers: { authorization: 'Bearer cron-secret' },
    })
    expect(response.status).toBe(500)
    const body = (await response.json()) as { ok: boolean; error: string; summary: string | null; down: string[] }
    expect(body).toMatchObject({ ok: false, error: 'refused', summary: 'daily' })
    expect(body.down).toHaveLength(1)
    expect(site.id).toBeTruthy()
  })
})
