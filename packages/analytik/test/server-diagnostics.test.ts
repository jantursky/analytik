import { afterEach, describe, expect, it } from 'vitest'

import { memoryStorage } from '../src/storage/memory'
import { PASSWORD, type TestServer, testServer } from './helpers/server'

let server: TestServer

afterEach(async () => {
  await server.close()
})

/** A server whose database can be switched off after the admin has logged in. */
async function brokenServer(options: { debug?: boolean } = {}) {
  const storage = memoryStorage()
  let broken = false
  const query = storage.query.bind(storage)
  storage.query = (sql: string, params?: unknown[]) =>
    broken ? Promise.reject(new Error('connect ECONNREFUSED db.internal:5432')) : query(sql, params)
  server = await testServer('memory', { storage, ...options })
  const login = await server.request('/auth/login', { method: 'POST', body: JSON.stringify({ password: PASSWORD }) })
  broken = true
  return (login.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
}

const errorOf = async (response: Response): Promise<string | undefined> =>
  ((await response.json()) as { error?: string }).error

describe('not found', () => {
  it('names the base path', async () => {
    server = await testServer()
    const response = await server.request('/nope')
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'not found (routes are under /api)' })
  })

  it('names a custom base path', async () => {
    server = await testServer('memory', { basePath: '/stats' })
    const response = await server.analytik.app.request('https://analytics.example.com/stats/nope')
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'not found (routes are under /stats)' })
  })
})

describe('health failure detail', () => {
  it('is bare for an anonymous caller', async () => {
    await brokenServer()
    const response = await server.request('/health')
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ ok: false, dialect: 'memory' })
  })

  it('carries the message for an admin Bearer token', async () => {
    await brokenServer()
    const response = await server.admin('/health')
    expect(response.status).toBe(503)
    expect(await errorOf(response)).toContain('ECONNREFUSED')
  })

  it('carries the message for an admin cookie', async () => {
    const cookie = await brokenServer()
    const response = await server.request('/health', { headers: { cookie } })
    expect(await errorOf(response)).toContain('ECONNREFUSED')
  })

  it('carries the message in debug mode', async () => {
    await brokenServer({ debug: true })
    const response = await server.request('/health')
    expect(response.status).toBe(503)
    expect(await errorOf(response)).toContain('ECONNREFUSED')
  })
})
