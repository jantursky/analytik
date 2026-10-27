import { afterEach, describe, expect, it } from 'vitest'

import { sessionToken, verifySessionToken } from '../src/server/auth'
import { createAnalytik } from '../src/server'
import { memoryStorage } from '../src/storage/memory'
import { DAY, MINUTE } from '../src/shared/time'
import { PASSWORD, SECRET, START, type TestServer, testServer } from './helpers/server'

let server: TestServer

afterEach(async () => {
  await server.close()
})

const login = (password: unknown, headers: Record<string, string> = {}) =>
  server.request('/auth/login', {
    method: 'POST',
    headers: { 'cf-connecting-ip': '198.51.100.9', ...headers },
    body: JSON.stringify({ password }),
  })

describe('admin login', () => {
  it('sets an HttpOnly session cookie and returns the same token for Bearer use', async () => {
    server = await testServer()
    const response = await login(PASSWORD)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { token: string; expiresAt: number }
    expect(body.expiresAt).toBe(START + 30 * DAY)
    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toContain(`analytik_session=${body.token}`)
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=Lax/i)
    expect(cookie).toMatch(/Secure/i)
    expect(cookie).toContain('Path=/api')

    const viaCookie = await server.request('/auth/me', { headers: { cookie: `analytik_session=${body.token}` } })
    expect(await viaCookie.json()).toEqual({ loggedIn: true, login: 'password' })
    const viaBearer = await server.request('/sites', { headers: { authorization: `Bearer ${body.token}` } })
    expect(viaBearer.status).toBe(200)
  })

  it('rejects wrong passwords and locks out after ten failures', async () => {
    server = await testServer()
    for (let attempt = 0; attempt < 10; attempt++) expect((await login('wrong')).status).toBe(401)
    expect((await login(PASSWORD)).status).toBe(429)
    expect((await login(PASSWORD, { 'cf-connecting-ip': '198.51.100.10' })).status).toBe(200)
    server.advance(15 * MINUTE)
    expect((await login(PASSWORD)).status).toBe(200)
    const keys = await server.rows<{ key: string }>('SELECT key FROM rate_limits')
    expect(keys.every((row) => !row.key.includes('198.51.100'))).toBe(true)
  })

  it('rejects a missing password and bad JSON', async () => {
    server = await testServer()
    expect((await login(undefined)).status).toBe(401)
    expect((await server.request('/auth/login', { method: 'POST', body: '{' })).status).toBe(400)
    expect((await server.request('/auth/login', { method: 'POST', body: '[1]' })).status).toBe(400)
    const huge = await server.request('/auth/login', { method: 'POST', body: 'x'.repeat(70_000) })
    expect(huge.status).toBe(413)
  })

  it('logs out by clearing the cookie', async () => {
    server = await testServer()
    const response = await server.request('/auth/logout', { method: 'POST' })
    expect(response.headers.get('set-cookie')).toMatch(/analytik_session=;.*Max-Age=0/i)
    expect(await (await server.request('/auth/me')).json()).toEqual({ loggedIn: false, login: 'password' })
  })

  it('refuses expired, forged and malformed tokens', async () => {
    server = await testServer()
    const expired = await sessionToken(SECRET, START - 1)
    const forged = await sessionToken('another-secret', START + DAY)
    for (const token of [expired, forged, 'admin.123', 'nonsense', `${forged}x`]) {
      expect((await server.request('/sites', { headers: { authorization: `Bearer ${token}` } })).status).toBe(401)
    }
    expect(await verifySessionToken(SECRET, undefined, START)).toBe(false)
    expect(await verifySessionToken(SECRET, await sessionToken(SECRET, START + 1), START)).toBe(true)
  })

  it('refuses cross-origin writes made with the cookie', async () => {
    server = await testServer()
    const cookie = `analytik_session=${server.token}`
    const create = (origin: string) =>
      server.request('/sites', {
        method: 'POST',
        headers: { cookie, origin },
        body: JSON.stringify({ domain: 'example.org' }),
      })
    expect((await create('https://evil.example')).status).toBe(403)
    expect((await create('not a url')).status).toBe(403)
    expect((await create('https://analytics.example.com')).status).toBe(201)
  })
})

describe('admin options', () => {
  it('answers 401 everywhere when no admin is configured', async () => {
    server = await testServer('memory', { admin: undefined })
    expect((await server.request('/sites')).status).toBe(401)
    expect((await login(PASSWORD)).status).toBe(401)
    expect(await (await server.request('/auth/me')).json()).toEqual({ loggedIn: false, login: 'none' })
  })

  it('delegates to a custom verify function', async () => {
    server = await testServer('memory', {
      admin: { verify: (request) => request.headers.get('x-admin') === 'yes' },
    })
    expect((await server.request('/sites')).status).toBe(401)
    expect((await server.request('/sites', { headers: { 'x-admin': 'yes' } })).status).toBe(200)
    expect((await login(PASSWORD)).status).toBe(400)
    expect(await (await server.request('/auth/me', { headers: { 'x-admin': 'yes' } })).json()).toEqual({
      loggedIn: true,
      login: 'custom',
    })
  })

  it('serves under a custom base path and reports health', async () => {
    const analytik = createAnalytik({ storage: memoryStorage(), basePath: '/stats/' })
    const health = await analytik.app.request('http://localhost/stats/health')
    expect(await health.json()).toEqual({ ok: true, dialect: 'memory' })
    expect((await analytik.app.request('http://localhost/api/health')).status).toBe(404)
    await analytik.storage.close?.()
    server = await testServer()
  })

  it('reports an unhealthy database and retries migrations on the next request', async () => {
    const storage = memoryStorage()
    let failures = 1
    const flaky = {
      ...storage,
      migrate: async () => {
        if (failures-- > 0) throw new Error('database unavailable')
        return storage.migrate()
      },
    }
    const analytik = createAnalytik({ storage: flaky })
    expect((await analytik.app.request('http://localhost/api/health')).status).toBe(503)
    expect((await analytik.app.request('http://localhost/api/health')).status).toBe(200)
    await storage.close?.()
    server = await testServer()
  })

  it('hides unexpected errors behind a 500', async () => {
    const storage = memoryStorage()
    const broken = { ...storage, query: () => Promise.reject(new Error('boom')) }
    const analytik = createAnalytik({ storage: broken, autoMigrate: false })
    const errors: unknown[] = []
    const original = console.error
    console.error = (error: unknown) => errors.push(error)
    try {
      const response = await analytik.app.request('http://localhost/api/event', {
        method: 'POST',
        headers: { 'user-agent': 'Mozilla/5.0 Chrome/141.0' },
        body: JSON.stringify({ w: 'site-00001', t: 'pageview', u: 'https://example.com/' }),
      })
      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({ error: 'internal error' })
      expect(errors).toHaveLength(1)
    } finally {
      console.error = original
    }
    await storage.close?.()
    server = await testServer()
  })
})
