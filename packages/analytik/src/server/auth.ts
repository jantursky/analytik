import type { Context as HonoContext, MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'

import { hmacSha256, timingSafeEqual, toBase64Url } from '../shared/crypto'
import { DAY, MINUTE } from '../shared/time'
import { AnalytikError, type Context } from './context'
import { hashedKey } from './privacy'
import { hit, hits, reset } from './ratelimit'
import type { AdminPasswordAuth } from './types'

export const SESSION_COOKIE = 'analytik_session'
const SESSION_LIFETIME = 30 * DAY
const LOGIN_WINDOW = 15 * MINUTE
const LOGIN_ATTEMPTS = 10

const isPasswordAuth = (admin: Context['admin']): admin is AdminPasswordAuth =>
  !!admin && 'password' in admin && 'secret' in admin

async function sign(secret: string, value: string): Promise<string> {
  return `${value}.${toBase64Url(await hmacSha256(secret, value))}`
}

/** Session token: `admin.<expiry>.<HMAC-SHA256 signature>`. */
export function sessionToken(secret: string, expiresAt: number): Promise<string> {
  return sign(secret, `admin.${expiresAt}`)
}

export async function verifySessionToken(secret: string, token: string | undefined, now: number): Promise<boolean> {
  const match = token ? /^admin\.(\d{1,15})\.[\w-]+$/.exec(token) : null
  if (!token || !match || Number(match[1]) <= now) return false
  return timingSafeEqual(token, await sessionToken(secret, Number(match[1])))
}

export type AdminMethod = 'cookie' | 'bearer' | 'custom'

/** How the request proves it comes from an admin, or null. */
export async function adminMethod(ctx: Context, c: HonoContext): Promise<AdminMethod | null> {
  const { admin } = ctx
  if (!admin) return null
  if (!isPasswordAuth(admin)) return (await admin.verify(c.req.raw)) ? 'custom' : null
  const bearer = /^Bearer\s+(.+)$/i.exec(c.req.header('authorization') ?? '')?.[1]
  if (bearer) return (await verifySessionToken(admin.secret, bearer, ctx.now())) ? 'bearer' : null
  return (await verifySessionToken(admin.secret, getCookie(c, SESSION_COOKIE), ctx.now())) ? 'cookie' : null
}

/**
 * Rejects non-admins. Cookie-authenticated writes must also come from the same origin: SameSite=Lax
 * already blocks most cross-site posts, this closes the rest.
 */
export function requireAdmin(ctx: Context): MiddlewareHandler {
  return async (c, next) => {
    const method = await adminMethod(ctx, c)
    if (!method) throw new AnalytikError('login required', 401)
    const origin = c.req.header('origin')
    if (method === 'cookie' && c.req.method !== 'GET' && origin && !sameHost(origin, c.req.url)) {
      throw new AnalytikError('cross-origin request refused', 403)
    }
    await next()
  }
}

function sameHost(origin: string, url: string): boolean {
  try {
    return new URL(origin).host === new URL(url).host
  } catch {
    return false
  }
}

/** POST /auth/login: password in, signed cookie (and the same token for Bearer use) out. */
export async function login(ctx: Context, c: HonoContext, password: unknown): Promise<Response> {
  const { admin } = ctx
  if (!admin) throw new AnalytikError('admin login is not configured', 401)
  if (!isPasswordAuth(admin)) throw new AnalytikError('login is handled by the verify() option', 400)
  // Without a trusted client IP every caller shares one counter: stricter, but it can't be dodged.
  const key = await hashedKey(ctx, 'login', ctx.clientIp(c.req.raw) ?? '')
  if ((await hits(ctx, key, LOGIN_WINDOW)) >= LOGIN_ATTEMPTS) {
    throw new AnalytikError('too many failed logins, try again in 15 minutes', 429)
  }
  if (typeof password !== 'string' || !timingSafeEqual(password, admin.password)) {
    await hit(ctx, key, LOGIN_WINDOW)
    throw new AnalytikError('wrong password', 401)
  }
  await reset(ctx, key)
  const expiresAt = ctx.now() + SESSION_LIFETIME
  const token = await sessionToken(admin.secret, expiresAt)
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: ctx.basePath || '/',
    maxAge: SESSION_LIFETIME / 1000,
  })
  return c.json({ ok: true, token, expiresAt })
}

export function logout(ctx: Context, c: HonoContext): Response {
  deleteCookie(c, SESSION_COOKIE, { path: ctx.basePath || '/' })
  return c.json({ ok: true })
}

/** GET /auth/me: whether the caller is logged in and how the dashboard should offer login. */
export async function me(ctx: Context, c: HonoContext): Promise<Response> {
  const login = !ctx.admin ? 'none' : isPasswordAuth(ctx.admin) ? 'password' : 'custom'
  return c.json({ loggedIn: (await adminMethod(ctx, c)) !== null, login })
}
