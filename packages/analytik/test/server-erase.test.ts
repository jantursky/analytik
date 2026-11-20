import { afterEach, describe, expect, it } from 'vitest'

import type { EraseResult, VisitorExport } from '../src/server/types'
import type { Site } from '../src/shared/types'
import { storageKinds } from './helpers/databases'
import { PASSWORD, type TestServer, testServer } from './helpers/server'

const EMPTY: EraseResult = { events: 0, sessions: 0, visitors: 0, payments: 0, claims: 0 }

describe.each(storageKinds())('erasing one visitor on %s', (kind) => {
  let server: TestServer
  let site: Site

  const open = async () => {
    server = await testServer(kind)
    site = (await server.createSite({ privacyMode: 'persistent' })).site
  }
  afterEach(() => server.close())

  /** A persistent-mode visit: a pageview and a goal, and an email when one is given. */
  const visit = async (vid: string, sid: string, email?: string) => {
    const base = { w: site.id, u: 'https://example.com/', m: 'persistent', vid, sid }
    await server.event({ ...base, t: 'pageview' })
    await server.event({ ...base, t: 'goal', n: 'signup' })
    if (email) await server.event({ ...base, t: 'identify', p: { email, name: 'Ann' } })
  }

  const payment = (id: string, visitor: string | null, email: string | null, amount = 1000) =>
    server.storage.run(
      `INSERT INTO payments (id, site_id, provider, ts, amount, kind, currency, visitor_id, session_id, customer_id, email, name)
       VALUES (?, ?, 'test', ?, ?, 'payment', 'USD', ?, ?, ?, ?, ?)`,
      [id, site.id, server.now, amount, visitor, visitor && 's', email && 'cus_1', email, email && 'Ann'],
    )

  const claim = (paymentId: string, visitor: string) =>
    server.storage.run('INSERT INTO payment_claims (site_id, payment_id, visitor_id, ts) VALUES (?, ?, ?, ?)', [
      site.id,
      paymentId,
      visitor,
      server.now,
    ])

  const erase = (query: string) =>
    server.adminJson<EraseResult>(`/sites/${site.id}/visitors?${query}`, { method: 'DELETE' })

  const counts = async (visitor: string) => ({
    events: (await server.rows('SELECT 1 FROM events WHERE visitor_id = ?', [visitor])).length,
    sessions: (await server.rows('SELECT 1 FROM sessions WHERE visitor_id = ?', [visitor])).length,
    visitors: (await server.rows('SELECT 1 FROM visitors WHERE id = ?', [visitor])).length,
    claims: (await server.rows('SELECT 1 FROM payment_claims WHERE visitor_id = ?', [visitor])).length,
  })

  it('removes one visitor by id and leaves everyone else alone', async () => {
    await open()
    await visit('visitor-a', 'session-a', 'ann@example.com')
    await visit('visitor-b', 'session-b')
    await payment('pay_a', 'visitor-a', 'ann@example.com')
    await claim('pay_a', 'visitor-a')
    await payment('pay_b', 'visitor-b', 'bob@example.com', 500)

    const result = await erase('visitor=visitor-a')
    expect(result).toEqual({ events: 2, sessions: 1, visitors: 1, payments: 1, claims: 1 })
    expect(await counts('visitor-a')).toEqual({ events: 0, sessions: 0, visitors: 0, claims: 0 })
    expect((await counts('visitor-b')).events).toBeGreaterThan(0)

    // The payment stays for the revenue numbers, with nothing that points at the person.
    const [paid] = await server.rows('SELECT * FROM payments WHERE id = ?', ['pay_a'])
    expect(paid).toMatchObject({
      amount: 1000,
      email: null,
      name: null,
      customer_id: null,
      visitor_id: null,
      session_id: null,
    })
    const [other] = await server.rows('SELECT * FROM payments WHERE id = ?', ['pay_b'])
    expect(other).toMatchObject({ visitor_id: 'visitor-b', email: 'bob@example.com' })
  })

  it('removes every visitor an email was given to, and the payments that carry it', async () => {
    await open()
    await visit('visitor-a', 'session-a', 'Ann@Example.com')
    await visit('visitor-c', 'session-c', 'ann@example.com')
    await visit('visitor-b', 'session-b', 'bob@example.com')
    await payment('pay_unclaimed', null, 'ANN@example.com')

    const result = await erase('email=ann%40example.com')
    expect(result.visitors).toBe(2)
    expect(result.payments).toBe(1)
    expect((await counts('visitor-a')).visitors + (await counts('visitor-c')).visitors).toBe(0)
    expect((await counts('visitor-b')).visitors).toBe(1)
    const [paid] = await server.rows('SELECT * FROM payments')
    expect(paid).toMatchObject({ email: null, name: null, amount: 1000 })
  })

  it('does nothing to another site, and answers with zeros for an unknown person', async () => {
    await open()
    await visit('visitor-a', 'session-a')
    const other = (await server.createSite({ domain: 'other.example', privacyMode: 'persistent' })).site
    const response = await server.adminJson<EraseResult>(`/sites/${other.id}/visitors?visitor=visitor-a`, {
      method: 'DELETE',
    })
    expect(response).toEqual(EMPTY)
    expect((await counts('visitor-a')).events).toBeGreaterThan(0)
    expect(await erase('visitor=nobody')).toEqual(EMPTY)
    expect(await erase('email=nobody%40example.com')).toEqual(EMPTY)
  })

  it('erases a person with more sessions than one statement can bind', async () => {
    await open()
    for (let i = 0; i < 3; i++) await visit('visitor-a', `session-${i}`)
    const many = Array.from({ length: 130 }, (_, i) => `v-${i}`)
    for (const id of many) {
      await server.storage.run('INSERT INTO visitors (site_id, id, first_seen, email) VALUES (?, ?, ?, ?)', [
        site.id,
        id,
        server.now,
        'many@example.com',
      ])
    }
    const result = await erase('email=many%40example.com')
    expect(result.visitors).toBe(130)
    expect((await counts('visitor-a')).events).toBeGreaterThan(0)
  })

  it('asks for exactly one of visitor or email', async () => {
    await open()
    for (const query of ['', 'visitor=a&email=b%40c.d']) {
      const response = await server.admin(`/sites/${site.id}/visitors?${query}`, { method: 'DELETE' })
      expect(response.status).toBe(400)
    }
    expect((await server.admin(`/sites/${site.id}/visitors/export`)).status).toBe(400)
  })

  it('exports what is held about one person, and no one else', async () => {
    await open()
    await visit('visitor-a', 'session-a', 'ann@example.com')
    await visit('visitor-b', 'session-b', 'bob@example.com')
    await payment('pay_a', 'visitor-a', 'ann@example.com')
    await payment('pay_other', null, 'ann@example.com', 700)
    await payment('pay_b', 'visitor-b', 'bob@example.com')

    const response = await server.admin(`/sites/${site.id}/visitors/export?email=ann%40example.com`)
    expect(response.headers.get('content-disposition')).toMatch(
      /attachment; filename="analytik-.*-visitor-\d{4}-\d{2}-\d{2}\.json"/,
    )
    const data = (await response.json()) as VisitorExport
    expect(data).toMatchObject({ version: 1, siteId: site.id, subject: { email: 'ann@example.com' } })
    expect(data.visitors.map((v) => v.id)).toEqual(['visitor-a'])
    expect(new Set(data.events.map((e) => e.visitor_id))).toEqual(new Set(['visitor-a']))
    expect(data.sessions).toHaveLength(1)
    expect(data.payments.map((p) => p.id).sort()).toEqual(['pay_a', 'pay_other'])
  })

  it('is closed to API keys, even a write key, and needs the admin', async () => {
    await open()
    const created = await server.admin('/api-keys', {
      method: 'POST',
      json: { label: 'Ops', scope: 'write', password: PASSWORD },
    })
    const { secret } = (await created.json()) as { secret: string }
    const asKey = (path: string, method = 'GET') =>
      server.request(`/v1/sites/${site.id}${path}`, { method, headers: { authorization: `Bearer ${secret}` } })
    expect((await asKey('/visitors?visitor=a', 'DELETE')).status).toBe(403)
    expect((await asKey('/visitors/export?visitor=a')).status).toBe(403)
    expect((await server.request(`/sites/${site.id}/visitors?visitor=a`, { method: 'DELETE' })).status).toBe(401)
  })
})

describe('every table that points at a visitor is covered by erasure', () => {
  it('lists each table with a visitor_id column, so a new one cannot be forgotten', async () => {
    const server = await testServer('memory')
    try {
      const tables = await server.rows<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
      const withVisitor: string[] = []
      for (const { name } of tables) {
        const columns = await server.rows<{ name: string }>(`PRAGMA table_info(${name})`)
        if (columns.some((column) => column.name === 'visitor_id')) withVisitor.push(name)
      }
      // events, sessions, payments and payment_claims are handled in server/stats/erase.ts; a new table with a
      // visitor_id column must be added there and to this list.
      expect(withVisitor.sort()).toEqual(['events', 'payment_claims', 'payments', 'sessions'])
    } finally {
      await server.close()
    }
  })
})
