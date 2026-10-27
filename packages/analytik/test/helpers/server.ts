import { createAnalytik } from '../../src/server'
import type { CreateAnalytikOptions } from '../../src/server/types'
import type { Site } from '../../src/shared/types'
import { type StorageKind, createStorage } from './databases'

export const PASSWORD = 'correct horse battery staple'
export const SECRET = 'test-secret-that-is-long-enough-1234567890'
export const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
export const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

/** 2026-03-16 12:00 UTC, a Monday. */
export const START = Date.UTC(2026, 2, 16, 12)

export type TestServer = Awaited<ReturnType<typeof testServer>>

/** A server on a real database with a controllable clock, plus request helpers. */
export async function testServer(kind: StorageKind = 'memory', options: Partial<CreateAnalytikOptions> = {}) {
  const storage = await createStorage(kind)
  let now = START
  const analytik = createAnalytik({
    storage,
    admin: { password: PASSWORD, secret: SECRET },
    // The helpers send `cf-connecting-ip` the way Cloudflare does; `auto` would only trust it with `request.cf`.
    trustProxy: 'cloudflare',
    now: () => now,
    ...options,
  })
  const base = 'https://analytics.example.com/api'

  const request = (path: string, init: RequestInit = {}) => analytik.app.request(`${base}${path}`, init)

  const loginResponse = await request('/auth/login', { method: 'POST', body: JSON.stringify({ password: PASSWORD }) })
  const { token } = (await loginResponse.json()) as { token?: string }

  /** An admin request with the Bearer token. */
  const admin = (path: string, init: RequestInit & { json?: unknown } = {}) => {
    const { json, ...rest } = init
    return request(path, {
      ...rest,
      headers: { authorization: `Bearer ${token ?? ''}`, ...(rest.headers as Record<string, string> | undefined) },
      ...(json !== undefined && { body: JSON.stringify(json) }),
    })
  }

  const adminJson = async <T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> => {
    const response = await admin(path, init)
    if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`)
    return (await response.json()) as T
  }

  const createSite = (input: Record<string, unknown> = {}) =>
    adminJson<{ site: Site; apiKey: string }>('/sites', {
      method: 'POST',
      json: { name: 'Example', domain: 'example.com', ...input },
    })

  /** Posts a tracker event the way a browser would, one millisecond after the previous one so order is stable. */
  const event = (payload: Record<string, unknown>, headers: Record<string, string> = {}) => {
    now += 1
    return request('/event', {
      method: 'POST',
      headers: {
        'content-type': 'text/plain',
        'user-agent': CHROME,
        'cf-connecting-ip': '203.0.113.7',
        origin: 'https://example.com',
        ...headers,
      },
      body: JSON.stringify(payload),
    })
  }

  return {
    analytik,
    storage,
    request,
    admin,
    adminJson,
    createSite,
    event,
    token: token ?? '',
    get now() {
      return now
    },
    set now(value: number) {
      now = value
    },
    advance(ms: number) {
      now += ms
    },
    rows: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => storage.query<T>(sql, params),
    close: () => storage.close?.(),
  }
}
