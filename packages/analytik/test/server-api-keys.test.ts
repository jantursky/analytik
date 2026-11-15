import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createContext } from '../src/server/context'
import type { EmailMessage } from '../src/server/email/types'
import { KEY_ROUTES } from '../src/server/key-access'
import { type AdminEnv, adminRoutes } from '../src/server/routes/admin'
import { sha256Hex } from '../src/shared/crypto'
import { DAY, HOUR, MINUTE } from '../src/shared/time'
import type { ApiKey, ApiKeyEvent } from '../src/shared/types'
import { PASSWORD, type TestServer, testServer } from './helpers/server'

let server: TestServer
beforeEach(async () => {
  server = await testServer()
})
afterEach(() => server.close())

interface Created {
  key: ApiKey
  secret: string
}

const create = async (json: Record<string, unknown> = {}, password: string | null = PASSWORD) => {
  const response = await server.admin('/api-keys', {
    method: 'POST',
    json: { label: 'Grafana', ...(password !== null && { password }), ...json },
  })
  return { response, body: (await response.clone().json()) as Created }
}

const made = async (json: Record<string, unknown> = {}): Promise<Created> => {
  const { response, body } = await create(json)
  expect(response.status).toBe(201)
  return body
}

const asKey = (secret: string, path: string, init: RequestInit = {}) =>
  server.request(path, {
    ...init,
    headers: { authorization: `Bearer ${secret}`, ...(init.headers as Record<string, string> | undefined) },
  })

const act = (path: string, method: string, json: Record<string, unknown> = { password: PASSWORD }) =>
  server.admin(path, { method, json })

describe('creating keys', () => {
  it('returns the secret once and stores only its hash', async () => {
    const { response, body } = await create({ scope: 'write', expiresInDays: 30 })
    expect(response.status).toBe(201)
    expect(body.secret).toMatch(/^anl_[\w-]{43}$/)
    expect(body.key).toMatchObject({
      label: 'Grafana',
      scope: 'write',
      siteIds: [],
      expiresAt: server.now + 30 * DAY,
      lastUsedAt: null,
      state: 'active',
      prefix: body.secret.slice(0, 8),
    })
    const rows = await server.rows<{ token_hash: string }>('SELECT token_hash FROM api_keys')
    expect(rows).toEqual([{ token_hash: await sha256Hex(body.secret) }])
    expect(JSON.stringify(await server.rows('SELECT * FROM api_keys'))).not.toContain(body.secret)
    expect(JSON.stringify(await server.rows('SELECT * FROM api_key_events'))).not.toContain(body.secret)
    const list = await server.adminJson<ApiKey[]>('/api-keys')
    expect(list).toHaveLength(1)
    expect(JSON.stringify(list)).not.toContain(body.secret)
  })

  it('defaults to a read key for every site', async () => {
    const { key } = await made({ label: undefined })
    expect(key).toMatchObject({ label: '', scope: 'read', siteIds: [], expiresAt: null })
  })

  it('rejects bad input', async () => {
    const { site } = await server.createSite()
    for (const bad of [
      { scope: 'admin' },
      { label: 'x'.repeat(81) },
      { siteIds: ['nope'] },
      { siteIds: 'all' },
      { expiresInDays: 0 },
      { expiresInDays: 3651 },
      { expiresInDays: 1.5 },
    ]) {
      expect((await create(bad)).response.status, JSON.stringify(bad)).toBe(400)
    }
    expect((await create({ siteIds: [site.id, site.id] })).response.status).toBe(201)
    expect(await server.adminJson<ApiKey[]>('/api-keys')).toHaveLength(1)
  })

  it('stops at 20 keys', async () => {
    for (let i = 0; i < 20; i++) await made()
    const { response } = await create()
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('20') as string })
  })
})

describe('password confirmation', () => {
  it('refuses a wrong or missing password and creates nothing', async () => {
    expect((await create({}, 'wrong')).response.status).toBe(403)
    expect((await create({}, null)).response.status).toBe(403)
    expect(await server.adminJson<ApiKey[]>('/api-keys')).toEqual([])
  })

  it('counts wrong passwords and then answers 429 even for the right one', async () => {
    for (let i = 0; i < 10; i++) expect((await create({}, 'wrong')).response.status).toBe(403)
    expect((await create({}, 'wrong')).response.status).toBe(429)
    expect((await create({})).response.status).toBe(429)
    server.advance(16 * MINUTE)
    expect((await create({})).response.status).toBe(201)
  })

  it('does not lock out an admin who keeps typing the right password', async () => {
    for (let i = 0; i < 15; i++) expect((await create()).response.status).toBe(201)
  })

  it('asks for it on create, roll, enable and delete, but not on disable', async () => {
    const { key } = await made()
    expect((await server.admin(`/api-keys/${key.id}/disable`, { method: 'POST' })).status).toBe(200)
    for (const [path, method] of [
      [`/api-keys/${key.id}/enable`, 'POST'],
      [`/api-keys/${key.id}/roll`, 'POST'],
      [`/api-keys/${key.id}`, 'DELETE'],
    ] as const) {
      expect((await act(path, method, { password: 'wrong' })).status, path).toBe(403)
    }
    expect((await act(`/api-keys/${key.id}/enable`, 'POST')).status).toBe(200)
  })

  it('is skipped for admins verified by the verify() option', async () => {
    await server.close()
    server = await testServer('memory', { admin: { verify: () => true } })
    const response = await server.admin('/api-keys', { method: 'POST', json: { label: 'x' } })
    expect(response.status).toBe(201)
  })
})

describe('rolling, disabling and deleting', () => {
  it('stops the old secret at once when rolled without a grace period', async () => {
    const { key, secret } = await made()
    const rolled = (await (await act(`/api-keys/${key.id}/roll`, 'POST')).json()) as Created
    expect(rolled.key).toMatchObject({ id: key.id, label: 'Grafana', scope: 'read', previousUntil: null })
    expect(rolled.secret).not.toBe(secret)
    expect((await asKey(secret, '/whoami')).status).toBe(401)
    expect((await asKey(rolled.secret, '/whoami')).status).toBe(200)
  })

  it('keeps both secrets for the grace period, then only the new one', async () => {
    const { key, secret } = await made()
    const rolled = (await (
      await act(`/api-keys/${key.id}/roll`, 'POST', { password: PASSWORD, graceHours: 24 })
    ).json()) as Created
    expect(rolled.key.previousUntil).toBe(server.now + DAY)
    expect((await asKey(secret, '/whoami')).status).toBe(200)
    expect((await asKey(rolled.secret, '/whoami')).status).toBe(200)
    server.advance(25 * HOUR)
    expect((await asKey(secret, '/whoami')).status).toBe(401)
    expect((await asKey(rolled.secret, '/whoami')).status).toBe(200)
  })

  it('ends an earlier grace period when rolled again', async () => {
    const { key, secret } = await made()
    await act(`/api-keys/${key.id}/roll`, 'POST', { password: PASSWORD, graceHours: 24 })
    await act(`/api-keys/${key.id}/roll`, 'POST')
    expect((await asKey(secret, '/whoami')).status).toBe(401)
  })

  it('rejects a grace period outside 0 to 7 days', async () => {
    const { key } = await made()
    for (const graceHours of [-1, 169, 1.5, '3']) {
      expect((await act(`/api-keys/${key.id}/roll`, 'POST', { password: PASSWORD, graceHours })).status).toBe(400)
    }
  })

  it('keeps a disabled key disabled when it is rolled', async () => {
    const { key } = await made()
    await server.admin(`/api-keys/${key.id}/disable`, { method: 'POST' })
    const rolled = (await (await act(`/api-keys/${key.id}/roll`, 'POST')).json()) as Created
    expect(rolled.key.state).toBe('disabled')
    expect((await asKey(rolled.secret, '/whoami')).status).toBe(401)
  })

  it('answers 401 for a disabled key and works again once enabled', async () => {
    const { key, secret } = await made()
    await server.admin(`/api-keys/${key.id}/disable`, { method: 'POST' })
    expect((await asKey(secret, '/whoami')).status).toBe(401)
    expect((await server.adminJson<ApiKey[]>('/api-keys'))[0]!.state).toBe('disabled')
    await act(`/api-keys/${key.id}/enable`, 'POST')
    expect((await asKey(secret, '/whoami')).status).toBe(200)
  })

  it('removes a deleted key for good and answers 404 for an unknown one', async () => {
    const { key, secret } = await made()
    expect((await act(`/api-keys/${key.id}`, 'DELETE')).status).toBe(200)
    expect((await asKey(secret, '/whoami')).status).toBe(401)
    expect(await server.adminJson<ApiKey[]>('/api-keys')).toEqual([])
    expect((await act(`/api-keys/${key.id}`, 'DELETE')).status).toBe(404)
    expect((await act('/api-keys/nope/roll', 'POST')).status).toBe(404)
    expect((await server.admin('/api-keys/nope/disable', { method: 'POST' })).status).toBe(404)
    const events = await server.adminJson<ApiKeyEvent[]>('/api-keys/events')
    expect(events.map((e) => e.type)).toContain('deleted')
  })

  it('expires a key and shows it as expired', async () => {
    const { secret } = await made({ expiresInDays: 1 })
    expect((await asKey(secret, '/whoami')).status).toBe(200)
    server.advance(2 * DAY)
    expect((await asKey(secret, '/whoami')).status).toBe(401)
    expect((await server.adminJson<ApiKey[]>('/api-keys'))[0]!.state).toBe('expired')
  })

  it('does not change the expiry when rolled', async () => {
    const { key } = await made({ expiresInDays: 5 })
    const rolled = (await (await act(`/api-keys/${key.id}/roll`, 'POST')).json()) as Created
    expect(rolled.key.expiresAt).toBe(key.expiresAt)
  })
})

describe('last use and the audit log', () => {
  it('writes the last use at most once a minute', async () => {
    const { key, secret } = await made()
    const used = async () => (await server.adminJson<ApiKey[]>('/api-keys'))[0]!.lastUsedAt
    expect(await used()).toBeNull()
    const first = server.now
    await asKey(secret, '/whoami')
    expect(await used()).toBe(first)
    for (let i = 0; i < 20; i++) {
      server.advance(1000)
      await asKey(secret, '/whoami')
    }
    expect(await used()).toBe(first)
    server.advance(MINUTE)
    await asKey(secret, '/whoami')
    expect(await used()).toBe(server.now)
    expect(key.lastUsedAt).toBeNull()
  })

  it('records created, rolled, disabled, enabled and deleted', async () => {
    const { key } = await made()
    await act(`/api-keys/${key.id}/roll`, 'POST')
    await server.admin(`/api-keys/${key.id}/disable`, { method: 'POST' })
    await act(`/api-keys/${key.id}/enable`, 'POST')
    await act(`/api-keys/${key.id}`, 'DELETE')
    const events = await server.adminJson<ApiKeyEvent[]>('/api-keys/events')
    expect(events.map((e) => e.type).sort()).toEqual(['created', 'deleted', 'disabled', 'enabled', 'rolled'])
    expect(events[0]).toMatchObject({ keyId: key.id, label: 'Grafana', at: server.now })
  })

  it('keeps the newest 200 entries', async () => {
    const { key } = await made()
    for (let i = 0; i < 205; i++) {
      server.advance(1000)
      expect((await act(`/api-keys/${key.id}/roll`, 'POST')).status).toBe(200)
    }
    const events = await server.adminJson<ApiKeyEvent[]>('/api-keys/events')
    expect(events).toHaveLength(200)
    expect(events.every((e) => e.type === 'rolled')).toBe(true)
    expect(events[0]?.at).toBe(server.now)
  })

  it('records a refusal once a minute per route', async () => {
    const { secret } = await made()
    for (let i = 0; i < 3; i++) await asKey(secret, '/api-keys')
    const denied = (await server.adminJson<ApiKeyEvent[]>('/api-keys/events')).filter((e) => e.type === 'denied')
    expect(denied).toHaveLength(1)
    expect(denied[0]?.detail).toContain('GET /api-keys')
    server.advance(MINUTE)
    await asKey(secret, '/api-keys')
    expect((await server.adminJson<ApiKeyEvent[]>('/api-keys/events')).filter((e) => e.type === 'denied')).toHaveLength(
      2,
    )
  })
})

describe('authentication', () => {
  it('opens the routes of its sites with a Bearer key, plain and under /v1', async () => {
    const { site } = await server.createSite()
    const { secret } = await made()
    const plain = await asKey(secret, `/sites/${site.id}/overview`)
    const versioned = await asKey(secret, `/v1/sites/${site.id}/overview`)
    expect(plain.status).toBe(200)
    expect(versioned.status).toBe(200)
    expect(await versioned.json()).toEqual(await plain.json())
  })

  it('does not take a key in the address or in another header', async () => {
    const { site } = await server.createSite()
    const { secret } = await made()
    for (const path of [`?key=${secret}`, `?share=${secret}`]) {
      expect((await server.request(`/sites/${site.id}/overview${path}`)).status, path).toBe(401)
    }
    const header = await server.request(`/sites/${site.id}/overview`, { headers: { 'x-analytik-share': secret } })
    expect(header.status).toBe(401)
    expect((await server.request(`/sites/${site.id}/overview`)).status).toBe(401)
  })

  it('answers every unusable secret alike', async () => {
    const { key, secret } = await made()
    const deleted = await made()
    await server.admin(`/api-keys/${key.id}/disable`, { method: 'POST' })
    await act(`/api-keys/${deleted.key.id}`, 'DELETE')
    const answers = await Promise.all(
      [secret, deleted.secret, `anl_${'A'.repeat(43)}`].map(async (s) => {
        const response = await asKey(s, '/whoami')
        return [response.status, await response.text()]
      }),
    )
    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1)
    expect(answers[0]?.[0]).toBe(401)
  })

  it('never lets a key response be cached', async () => {
    const { site } = await server.createSite()
    const { secret } = await made()
    for (const path of ['overview', 'targets', 'vitals', 'journeys']) {
      const response = await asKey(secret, `/sites/${site.id}/${path}`)
      expect(response.status, path).toBe(200)
      expect(response.headers.get('cache-control'), path).toBe('no-store')
    }
  })

  it('leaves share links as they were', async () => {
    const { site } = await server.createSite()
    const { token } = await server.adminJson<{ token: string }>(`/sites/${site.id}/share-links`, {
      method: 'POST',
      json: {},
    })
    const response = await server.request(`/sites/${site.id}/overview?share=${token}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('public, s-maxage=60')
    const bearer = await asKey(token, `/sites/${site.id}/overview`)
    expect(bearer.status).toBe(200)
    expect(bearer.headers.get('cache-control')).not.toContain('public')
  })
})

describe('scopes and sites', () => {
  it('lets a read key read what a share link cannot, and nothing else', async () => {
    const { site } = await server.createSite()
    const { secret } = await made()
    for (const path of [
      '',
      '/payments',
      '/targets',
      '/vitals',
      '/retention',
      '/export',
      '/imports',
      '/sessions',
      '/funnels',
      '/properties?name=signup',
      '/breakdown?dimension=page',
    ]) {
      expect((await asKey(secret, `/sites/${site.id}${path}`)).status, path).toBe(200)
    }
    expect((await asKey(secret, '/summary')).status).toBe(200)
    const write = await asKey(secret, `/sites/${site.id}`, { method: 'PATCH', body: '{"name":"x"}' })
    expect(write.status).toBe(403)
    expect(await write.json()).toEqual({ error: 'this key is read-only' })
  })

  it('lets a write key change a site, notes and funnels', async () => {
    const { site } = await server.createSite()
    const { secret } = await made({ scope: 'write' })
    const renamed = await asKey(secret, `/sites/${site.id}`, { method: 'PATCH', body: '{"name":"Renamed"}' })
    expect(renamed.status).toBe(200)
    expect(await renamed.json()).toMatchObject({ name: 'Renamed' })
    const note = await asKey(secret, `/sites/${site.id}/annotations`, {
      method: 'POST',
      body: JSON.stringify({ date: '2026-03-10', text: 'Launch' }),
    })
    expect(note.status).toBe(201)
  })

  it('never lets even a write key do what is closed to keys', async () => {
    const { site } = await server.createSite()
    const { secret } = await made({ scope: 'write' })
    for (const [method, path] of [
      ['DELETE', `/sites/${site.id}`],
      ['POST', `/sites/${site.id}/rotate-key`],
      ['GET', `/sites/${site.id}/webhooks`],
      ['POST', `/sites/${site.id}/webhooks`],
      ['GET', `/sites/${site.id}/share-links`],
      ['POST', `/sites/${site.id}/share-links`],
      ['DELETE', `/sites/${site.id}/data?before=2026-01-01`],
      ['POST', '/sites'],
      ['GET', '/email'],
      ['PUT', '/email'],
      ['GET', '/preferences'],
      ['GET', '/site-defaults'],
      ['GET', '/my-ip'],
      ['POST', '/debug/generate'],
      ['GET', '/api-keys'],
      ['POST', '/api-keys'],
      ['GET', '/api-keys/events'],
      ['POST', '/api-keys/x/roll'],
      ['DELETE', '/api-keys/x'],
    ] as const) {
      const response = await asKey(secret, path, { method, body: method === 'GET' ? undefined : '{}' })
      expect(response.status, `${method} ${path}`).toBe(403)
    }
    expect(await server.adminJson<ApiKey[]>('/api-keys')).toHaveLength(1)
  })

  it('keeps a key to its own sites', async () => {
    const a = (await server.createSite()).site
    const b = (await server.createSite({ domain: 'other.com' })).site
    const { secret } = await made({ siteIds: [a.id] })
    expect((await asKey(secret, `/sites/${a.id}/overview`)).status).toBe(200)
    expect((await asKey(secret, `/sites/${b.id}/overview`)).status).toBe(403)
    expect((await asKey(secret, `/sites/${b.id}`)).status).toBe(403)
    const list = (await (await asKey(secret, '/sites')).json()) as { id: string }[]
    expect(list.map((s) => s.id)).toEqual([a.id])
    const summary = (await (await asKey(secret, '/summary')).json()) as { siteId?: string; id?: string }[]
    expect(summary).toHaveLength(1)
  })

  it('shows a key for all sites every site, including later ones', async () => {
    const { secret } = await made()
    await server.createSite()
    await server.createSite({ domain: 'other.com' })
    expect(((await (await asKey(secret, '/sites')).json()) as unknown[]).length).toBe(2)
    await server.createSite({ domain: 'third.com' })
    expect(((await (await asKey(secret, '/sites')).json()) as unknown[]).length).toBe(3)
  })

  it('keeps working for the other sites when one of its sites is deleted', async () => {
    const a = (await server.createSite()).site
    const b = (await server.createSite({ domain: 'other.com' })).site
    const { secret } = await made({ siteIds: [a.id, b.id] })
    expect(
      (await server.admin(`/sites/${b.id}`, { method: 'DELETE', json: { confirm: 'other.com', password: PASSWORD } }))
        .status,
    ).toBe(200)
    expect((await asKey(secret, `/sites/${a.id}/overview`)).status).toBe(200)
    expect(((await (await asKey(secret, '/sites')).json()) as { id: string }[]).map((s) => s.id)).toEqual([a.id])
  })

  it('under /v1 refuses what the plain path refuses', async () => {
    const { site } = await server.createSite()
    const { secret } = await made()
    const write = await asKey(secret, `/v1/sites/${site.id}`, { method: 'PATCH', body: '{"name":"x"}' })
    expect(write.status).toBe(403)
    expect(await write.json()).toEqual({ error: 'this key is read-only' })
    expect((await asKey(secret, '/v1/api-keys')).status).toBe(403)
    const me = await asKey(secret, '/v1/auth/me')
    expect(await me.json()).toMatchObject({ loggedIn: false })
  })

  it('classifies every admin route for keys, and lists no route that does not exist', () => {
    const ctx = createContext({ storage: server.storage, admin: { verify: () => true } })
    const app = new Hono<AdminEnv>()
    adminRoutes(app, ctx)
    const registered = app.routes.filter((r) => r.method !== 'ALL').map((r) => `${r.method} ${r.path}`)
    const classified = KEY_ROUTES.map((r) => `${r.method} ${r.path}`)
    expect(registered.filter((r) => !classified.includes(r))).toEqual([])
    expect(classified.filter((r) => !registered.includes(r))).toEqual([])
  })
})

describe('the API keys guide', () => {
  it('works as written: every call in its examples answers', async () => {
    const { site } = await server.createSite()
    const { secret } = await made({ scope: 'write' })
    const range = 'from=2026-10-01&to=2026-11-01'
    for (const path of [
      '/v1/whoami',
      '/v1/sites',
      `/v1/sites/${site.id}/overview?${range}`,
      `/v1/sites/${site.id}/timeseries?${range}&interval=day`,
      `/v1/sites/${site.id}/breakdown?dimension=source&${range}`,
      `/v1/sites/${site.id}/sessions?limit=50`,
      `/v1/sites/${site.id}/events?type=goal&name=signup`,
      `/v1/sites/${site.id}/payments?kind=payment`,
      `/v1/sites/${site.id}/funnels`,
      `/v1/sites/${site.id}/targets`,
      `/v1/sites/${site.id}/vitals`,
      `/v1/sites/${site.id}/export?format=csv&table=events`,
    ]) {
      expect((await asKey(secret, path)).status, path).toBe(200)
    }
    const json = { 'content-type': 'application/json' }
    const note = await asKey(secret, `/v1/sites/${site.id}/annotations`, {
      method: 'POST',
      headers: json,
      body: '{"date":"2026-11-02","text":"Launched the new pricing"}',
    })
    expect(note.status).toBe(201)
    const rename = await asKey(secret, `/v1/sites/${site.id}`, {
      method: 'PATCH',
      headers: json,
      body: '{"name":"Shop"}',
    })
    expect(rename.status).toBe(200)
  })
})

describe('whoami', () => {
  it('tells a key its scope, sites, expiry and what is left of its limit, never its secret', async () => {
    const { site } = await server.createSite()
    const { secret, key } = await made({ siteIds: [site.id], expiresInDays: 3 })
    const response = await asKey(secret, '/whoami')
    const body = (await response.json()) as Record<string, unknown>
    expect(body).toMatchObject({
      kind: 'key',
      id: key.id,
      label: 'Grafana',
      scope: 'read',
      siteIds: [site.id],
      expiresAt: server.now + 3 * DAY,
      rateLimit: { limit: 120, remaining: 119 },
    })
    expect(JSON.stringify(body)).not.toContain(secret)
    expect(await server.adminJson('/whoami')).toEqual({ kind: 'admin' })
    expect((await server.request('/whoami')).status).toBe(401)
  })
})

describe('limits', () => {
  it('answers 429 with Retry-After past the per-minute limit', async () => {
    const { secret } = await made()
    for (let i = 0; i < 120; i++) expect((await asKey(secret, '/whoami')).status).toBe(200)
    const limited = await asKey(secret, '/whoami')
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(limited.headers.get('x-ratelimit-remaining')).toBe('0')
    server.advance(MINUTE)
    expect((await asKey(secret, '/whoami')).status).toBe(200)
  })

  it('shares the count between /v1 and the plain paths', async () => {
    const { secret } = await made()
    for (let i = 0; i < 60; i++) await asKey(secret, '/v1/whoami')
    for (let i = 0; i < 60; i++) await asKey(secret, '/whoami')
    expect((await asKey(secret, '/v1/whoami')).status).toBe(429)
  })

  it('limits costly routes lower than the rest', async () => {
    const { site } = await server.createSite()
    const { secret } = await made()
    for (let i = 0; i < 12; i++) expect((await asKey(secret, `/sites/${site.id}/export`)).status).toBe(200)
    expect((await asKey(secret, `/sites/${site.id}/export`)).status).toBe(429)
    expect((await asKey(secret, `/sites/${site.id}/overview`)).status).toBe(200)
    expect((await asKey(secret, `/sites/${site.id}/sessions?search=a`)).status).toBe(429)
  })

  it('sends the limit headers on a successful call', async () => {
    const { site } = await server.createSite()
    const { secret } = await made()
    const response = await asKey(secret, `/sites/${site.id}/overview`)
    expect(response.headers.get('x-ratelimit-limit')).toBe('120')
    expect(response.headers.get('x-ratelimit-remaining')).toBe('119')
    expect(Number(response.headers.get('x-ratelimit-reset'))).toBeGreaterThan(server.now / 1000)
  })

  it('can be tuned or switched off', async () => {
    await server.close()
    server = await testServer('memory', { keyRateLimit: { perMinute: false, heavy: 2 } })
    const { site } = await server.createSite()
    const { secret } = await made()
    for (let i = 0; i < 130; i++) expect((await asKey(secret, '/whoami')).status).toBe(200)
    expect((await asKey(secret, '/whoami')).headers.get('x-ratelimit-limit')).toBeNull()
    for (let i = 0; i < 2; i++) expect((await asKey(secret, `/sites/${site.id}/export`)).status).toBe(200)
    expect((await asKey(secret, `/sites/${site.id}/export`)).status).toBe(429)
  })

  it('can count in memory instead, with no database writes', async () => {
    await server.close()
    server = await testServer('memory', { keyRateLimit: { store: 'memory', heavy: 2 } })
    const { site } = await server.createSite()
    const { secret } = await made()
    const first = await asKey(secret, '/whoami')
    expect(first.headers.get('x-ratelimit-remaining')).toBe('119')
    expect(Number(first.headers.get('x-ratelimit-reset'))).toBe(Math.ceil((server.now + MINUTE) / 1000))
    for (let i = 0; i < 119; i++) expect((await asKey(secret, '/whoami')).status).toBe(200)
    const limited = await asKey(secret, '/whoami')
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(await server.rows("SELECT key FROM rate_limits WHERE key LIKE 'key:%'")).toEqual([])
    server.advance(MINUTE)
    expect((await asKey(secret, '/whoami')).status).toBe(200)
    for (let i = 0; i < 2; i++) expect((await asKey(secret, `/sites/${site.id}/export`)).status).toBe(200)
    expect((await asKey(secret, `/sites/${site.id}/export`)).status).toBe(429)
  })

  it('limits unknown secrets per address and leaves a valid key alone', async () => {
    const { secret } = await made()
    const guess = (ip: string) => asKey(`anl_${'B'.repeat(43)}`, '/whoami', { headers: { 'cf-connecting-ip': ip } })
    for (let i = 0; i < 30; i++) expect((await guess('198.51.100.1')).status).toBe(401)
    expect((await guess('198.51.100.1')).status).toBe(429)
    expect((await guess('198.51.100.2')).status).toBe(401)
    expect((await asKey(secret, '/whoami', { headers: { 'cf-connecting-ip': '198.51.100.2' } })).status).toBe(200)
    server.advance(16 * MINUTE)
    expect((await guess('198.51.100.1')).status).toBe(401)
  })

  it('can be retried after a 429 without anything happening twice', async () => {
    const { site } = await server.createSite()
    const { secret } = await made({ scope: 'write' })
    for (let i = 0; i < 120; i++) await asKey(secret, '/whoami')
    const note = { method: 'POST', body: JSON.stringify({ date: '2026-03-10', text: 'Launch' }) }
    expect((await asKey(secret, `/sites/${site.id}/annotations`, note)).status).toBe(429)
    expect(await server.rows('SELECT id FROM annotations')).toEqual([])
    server.advance(MINUTE)
    expect((await asKey(secret, `/sites/${site.id}/annotations`, note)).status).toBe(201)
    expect(await server.rows('SELECT id FROM annotations')).toHaveLength(1)
  })
})

describe('e-mail notices', () => {
  const setup = async (options: { fail?: boolean } = {}) => {
    await server.close()
    const inbox: EmailMessage[] = []
    server = await testServer('memory', {
      email: {
        from: 'analytik@example.com',
        to: 'me@example.com',
        send: (message) => {
          if (options.fail) return Promise.reject(new Error('sender down'))
          inbox.push(message)
          return Promise.resolve()
        },
      },
    })
    return inbox
  }

  it('is sent for create, roll, disable and delete, without the secret', async () => {
    const inbox = await setup()
    const { key, secret } = await made()
    const rolled = (await (await act(`/api-keys/${key.id}/roll`, 'POST')).json()) as Created
    await server.admin(`/api-keys/${key.id}/disable`, { method: 'POST' })
    await act(`/api-keys/${key.id}/enable`, 'POST')
    await act(`/api-keys/${key.id}`, 'DELETE')
    expect(inbox.map((m) => m.subject)).toEqual([
      'API key created: Grafana',
      'API key rolled: Grafana',
      'API key disabled: Grafana',
      'API key deleted: Grafana',
    ])
    expect(inbox.every((m) => m.to === 'me@example.com')).toBe(true)
    const all = JSON.stringify(inbox)
    expect(all).not.toContain(secret)
    expect(all).not.toContain(rolled.secret)
    expect(inbox[0]?.text).toContain(`Key: Grafana (${key.prefix}…)`)
  })

  it('is not attempted without a sender', async () => {
    const { key } = await made()
    expect((await act(`/api-keys/${key.id}`, 'DELETE')).status).toBe(200)
  })

  it('can be switched off in the e-mail settings', async () => {
    const inbox = await setup()
    await server.adminJson('/email', { method: 'PUT', json: { apiKeyAlerts: false } })
    const { key } = await made()
    await act(`/api-keys/${key.id}/roll`, 'POST')
    expect(inbox).toEqual([])
  })

  it('never fails the key action when the sender throws', async () => {
    await setup({ fail: true })
    const { key } = await made()
    expect((await act(`/api-keys/${key.id}/roll`, 'POST')).status).toBe(200)
    expect((await server.adminJson<ApiKeyEvent[]>('/api-keys/events')).map((e) => e.type)).toContain('rolled')
  })
})
