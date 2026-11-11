import type { Context as HonoContext } from 'hono'

import { MINUTE } from '../shared/time'
import type { ApiKey } from '../shared/types'
import { findApiKey, recordKeyEvent } from './api-keys'
import { AnalytikError, type Context } from './context'
import { allowedByList } from './ip-allowlist'
import { hashedKey } from './privacy'
import { hit } from './ratelimit'

type Access = 'read' | 'write' | 'closed'

interface KeyRoute {
  method: string
  /** The route as registered, with `:name` parameters. */
  path: string
  access: Access
  /** Costly routes count against the lower, shared limit. */
  heavy?: boolean | ((url: URL) => boolean)
}

const read = (path: string, heavy?: KeyRoute['heavy']): KeyRoute => ({
  method: 'GET',
  path,
  access: 'read',
  ...(heavy !== undefined && { heavy }),
})
const write = (method: string, path: string, heavy?: boolean): KeyRoute => ({
  method,
  path,
  access: 'write',
  ...(heavy !== undefined && { heavy }),
})
const closed = (method: string, path: string): KeyRoute => ({ method, path, access: 'closed' })

/**
 * Every admin route and what an API key may do with it. A route that is not listed is refused, so a new route stays
 * closed to keys until someone decides here; a test checks that every registered route has an entry.
 */
export const KEY_ROUTES: readonly KeyRoute[] = [
  read('/whoami'),
  read('/openapi.json'),
  read('/summary'),
  read('/sites'),
  read('/sites/:id'),
  read('/sites/:id/shared'),
  read('/sites/:id/favicon'),
  read('/sites/:id/overview'),
  read('/sites/:id/timeseries'),
  read('/sites/:id/properties'),
  read('/sites/:id/breakdown'),
  read('/sites/:id/bots'),
  read('/sites/:id/targets'),
  read('/sites/:id/vitals'),
  read('/sites/:id/journeys', true),
  read('/sites/:id/retention', true),
  read('/sites/:id/realtime'),
  read('/sites/:id/sessions', (url) => (url.searchParams.get('search') ?? '') !== ''),
  read('/sites/:id/sessions/:sid'),
  read('/sites/:id/events'),
  read('/sites/:id/event-log'),
  read('/sites/:id/funnels'),
  read('/sites/:id/funnels/:fid'),
  read('/sites/:id/payments'),
  read('/sites/:id/export', true),
  read('/sites/:id/imports'),
  write('PATCH', '/sites/:id'),
  write('POST', '/sites/:id/annotations'),
  write('PATCH', '/sites/:id/annotations/:nid'),
  write('DELETE', '/sites/:id/annotations/:nid'),
  write('POST', '/sites/:id/funnels'),
  write('DELETE', '/sites/:id/funnels/:fid'),
  write('POST', '/sites/:id/rematch'),
  write('POST', '/sites/:id/import', true),
  write('DELETE', '/sites/:id/imports/:source'),
  closed('POST', '/auth/login'),
  closed('POST', '/auth/logout'),
  closed('GET', '/auth/me'),
  closed('GET', '/preferences'),
  closed('PUT', '/preferences'),
  closed('GET', '/email'),
  closed('PUT', '/email'),
  closed('POST', '/email/test'),
  closed('GET', '/debug'),
  closed('POST', '/debug/generate'),
  closed('DELETE', '/debug/sites'),
  closed('GET', '/my-ip'),
  closed('GET', '/version'),
  closed('GET', '/site-defaults'),
  closed('PUT', '/site-defaults'),
  closed('POST', '/site-defaults/apply'),
  closed('POST', '/sites'),
  closed('DELETE', '/sites/:id'),
  closed('POST', '/sites/:id/rotate-key'),
  closed('POST', '/sites/:id/sync'),
  closed('POST', '/sites/:id/sync/apply'),
  closed('GET', '/sites/:id/share-links'),
  closed('POST', '/sites/:id/share-links'),
  closed('DELETE', '/sites/:id/share-links/:lid'),
  closed('GET', '/sites/:id/webhooks'),
  closed('POST', '/sites/:id/webhooks'),
  closed('PATCH', '/sites/:id/webhooks/:wid'),
  closed('DELETE', '/sites/:id/webhooks/:wid'),
  closed('POST', '/sites/:id/webhooks/:wid/test'),
  closed('DELETE', '/sites/:id/data'),
  closed('GET', '/api-keys'),
  closed('POST', '/api-keys'),
  closed('GET', '/api-keys/events'),
  closed('POST', '/api-keys/:id/roll'),
  closed('POST', '/api-keys/:id/disable'),
  closed('POST', '/api-keys/:id/enable'),
  closed('PATCH', '/api-keys/:id'),
  closed('DELETE', '/api-keys/:id'),
]

const compiled = KEY_ROUTES.map((route) => ({
  route,
  pattern: new RegExp(`^${route.path.replace(/:[a-z]+/gi, '[^/]+')}$`),
}))

/** The table entry for a request, or undefined for a route nobody has classified. */
export function classifyRoute(method: string, path: string): KeyRoute | undefined {
  return compiled.find((entry) => entry.route.method === method && entry.pattern.test(path))?.route
}

/** The route path without the base path and the optional `/v1` prefix. */
export const keyRoutePath = (ctx: Context, requestPath: string): string =>
  requestPath.slice(ctx.basePath.length).replace(/^\/v1(?=\/)/, '')

const KEY_FAIL_WINDOW = 15 * MINUTE
const KEY_FAIL_LIMIT = 30
const HEAVY_FLAG = 'heavy'

export interface KeyRate {
  limit: number
  remaining: number
  reset: number
}

/** The Bearer value of a request, or undefined. */
export const bearerOf = (c: HonoContext): string | undefined =>
  /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '')?.[1]

async function deny(ctx: Context, key: ApiKey, method: string, path: string, message: string): Promise<never> {
  // One audit line per key and route a minute, so a looping client cannot fill the log or the database.
  if ((await hit(ctx, `denied:${key.id}:${method} ${path}`, MINUTE)) === 1) {
    await recordKeyEvent(ctx, 'denied', key, `${method} ${path}: ${message}`)
  }
  throw new AnalytikError(message, 403)
}

async function limit(
  ctx: Context,
  c: HonoContext,
  key: ApiKey,
  bucket: string,
  max: number | false,
): Promise<KeyRate | null> {
  if (max === false) return null
  const name = `key:${key.id}:${bucket}`
  let count: number
  let reset: number
  if (ctx.keyRateLimit.store === 'memory') {
    const counted = ctx.keyLimit.count(name, ctx.now())
    count = counted.count
    reset = counted.resetsAt
  } else {
    count = await hit(ctx, name, MINUTE)
    reset = Math.floor(ctx.now() / MINUTE) * MINUTE + MINUTE
  }
  const rate = { limit: max, remaining: Math.max(0, max - count), reset: Math.ceil(reset / 1000) }
  c.header('x-ratelimit-limit', String(rate.limit))
  c.header('x-ratelimit-remaining', String(rate.remaining))
  c.header('x-ratelimit-reset', String(rate.reset))
  if (count > max) {
    c.header('retry-after', String(Math.max(1, Math.ceil((reset - ctx.now()) / 1000))))
    throw new AnalytikError('too many requests, wait for the time in Retry-After', 429)
  }
  return rate
}

/**
 * Lets a request through when it carries a usable API key whose scope, sites and limits allow it, and returns the key.
 * Everything else is an error with the status the docs promise: 401 for a key that cannot be used (all alike, so a
 * caller cannot tell why), 403 for one that is not allowed here, 429 for a limit.
 */
export async function authorizeKey(
  ctx: Context,
  c: HonoContext,
  secret: string,
): Promise<{ key: ApiKey; rate: KeyRate | null }> {
  const key = await findApiKey(ctx, secret)
  if (!key) {
    // Without a known client address one shared counter applies: stricter, but it cannot be dodged.
    const ip = await hashedKey(ctx, 'keyfail', ctx.clientIp(c.req.raw) ?? '')
    if ((await hit(ctx, ip, KEY_FAIL_WINDOW)) > KEY_FAIL_LIMIT) {
      throw new AnalytikError('too many requests with an unknown API key, try again later', 429)
    }
    throw new AnalytikError('invalid API key', 401)
  }
  const method = c.req.method
  const path = keyRoutePath(ctx, c.req.path)
  if (key.ipAllowlist.length > 0) {
    const ip = ctx.clientIp(c.req.raw)
    if (!allowedByList(key.ipAllowlist, ip)) {
      // The same answer for an address that is not listed and one that is not known; the list itself stays hidden.
      // One audit line per key and address a minute, so a scan cannot fill the log.
      const seen = ip ?? 'unknown'
      if ((await hit(ctx, `deniedip:${key.id}:${seen}`, MINUTE)) === 1) {
        await recordKeyEvent(ctx, 'denied_ip', key, seen)
      }
      throw new AnalytikError('this key cannot be used from this address', 403)
    }
  }
  const route = classifyRoute(method, path)
  if (!route || route.access === 'closed') {
    return deny(ctx, key, method, path, 'this route is not available to API keys')
  }
  if (route.access === 'write' && key.scope !== 'write') {
    return deny(ctx, key, method, path, 'this key is read-only')
  }
  const siteId = /^\/sites\/([^/]+)/.exec(path)?.[1]
  if (siteId && key.siteIds.length > 0 && !key.siteIds.includes(siteId)) {
    return deny(ctx, key, method, path, 'this key cannot use this site')
  }
  const rate = await limit(ctx, c, key, 'std', ctx.keyRateLimit.perMinute)
  const heavy = typeof route.heavy === 'function' ? route.heavy(new URL(c.req.url)) : route.heavy === true
  if (heavy) await limit(ctx, c, key, HEAVY_FLAG, ctx.keyRateLimit.heavy)
  return { key, rate }
}
