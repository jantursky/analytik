import type { Hono } from 'hono'
import { cors } from 'hono/cors'

import * as dodo from '../../adapters/dodo'
import * as lemonsqueezy from '../../adapters/lemonsqueezy'
import type { WebhookRequest } from '../../adapters/shared'
import * as stripe from '../../adapters/stripe'
import { isId, isSiteId, randomId } from '../../shared/ids'
import { MINUTE } from '../../shared/time'
import type { PaymentInput, PaymentProvider } from '../../shared/types'
import { clip } from '../../shared/url'
import { AnalytikError, type Context } from '../context'
import { SESSION_WINDOW, cleanProps, ingest } from '../ingest'
import { recordPayment } from '../payments'
import { hashedKey, strictVisitorId } from '../privacy'
import { hit } from '../ratelimit'
import { doNotTrack, geoFromRequest, readText } from '../request'
import { getSite, siteByApiKey } from '../sites'

const EVENT_LIMIT = 8 * 1024
const API_LIMIT = 64 * 1024
const WEBHOOK_LIMIT = 512 * 1024
const ATTRIBUTION_PER_MINUTE = 60

const ADAPTERS: Record<
  PaymentProvider,
  { verify(request: WebhookRequest): Promise<boolean>; toPayment(event: unknown): PaymentInput | null }
> = {
  stripe,
  dodo,
  lemonsqueezy,
}

async function readJson(request: Request, limit: number): Promise<unknown> {
  const text = await readText(request, limit)
  if (text === null) throw new AnalytikError('payload too large', 413)
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new AnalytikError('body must be JSON')
  }
}

const bearer = (request: Request) => /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1]

/** Tracker, attribution, server-side API and payment webhooks. */
export function publicRoutes(app: Hono, ctx: Context): void {
  const open = cors({ origin: '*', allowMethods: ['POST', 'OPTIONS'], maxAge: 86400 })
  app.use('/event', open)
  app.use('/attribution', open)

  app.post('/event', async (c) => {
    const text = await readText(c.req.raw, EVENT_LIMIT)
    if (text === null) return c.json({ error: 'payload too large' }, 413)
    let payload: unknown
    try {
      payload = JSON.parse(text)
    } catch {
      return c.json({ error: 'body must be JSON' }, 400)
    }
    const request = c.req.raw
    const result = await ingest(ctx, {
      payload,
      ip: ctx.clientIp(request),
      userAgent: c.req.header('user-agent') ?? null,
      origin: c.req.header('origin') ?? null,
      geo: await (ctx.geo ?? geoFromRequest)(request),
      doNotTrack: doNotTrack(request),
    })
    return 'error' in result ? c.json({ error: result.error }, result.status) : c.body(null, 202)
  })

  // Strict mode keeps nothing on the device, so checkout code asks the server for the ids to put in metadata.
  app.post('/attribution', async (c) => {
    const body = (await readJson(c.req.raw, EVENT_LIMIT)) as {
      w?: unknown
      site?: unknown
      m?: unknown
      sid?: unknown
    } | null
    const siteId = body?.w ?? body?.site
    const site = isSiteId(siteId) ? await getSite(ctx, siteId) : null
    if (!site) throw new AnalytikError('site not found', 404)
    const ip = ctx.clientIp(c.req.raw) ?? ''
    if ((await hit(ctx, await hashedKey(ctx, 'attribution', ip), MINUTE)) > ATTRIBUTION_PER_MINUTE) {
      throw new AnalytikError('too many requests', 429)
    }
    const now = ctx.now()
    const visitorId = await strictVisitorId(ctx, site.id, ip, c.req.header('user-agent') ?? '', now)
    const [session] = await ctx.storage.query<{ id: string }>(
      `SELECT id FROM sessions WHERE site_id = ? AND visitor_id = ? AND last_seen_at > ?
       ORDER BY last_seen_at DESC LIMIT 1`,
      [site.id, visitorId, now - SESSION_WINDOW],
    )
    // In enriched mode the tab id is the session id.
    const tabSession = body?.m === 'enriched' && isId(body.sid) && site.privacyMode !== 'strict' ? body.sid : null
    return c.json({ visitorId, sessionId: tabSession ?? session?.id ?? null })
  })

  app.post('/v1/payments', async (c) => {
    const site = await siteByApiKey(ctx, bearer(c.req.raw))
    if (!site) throw new AnalytikError('invalid api key', 401)
    const body = await readJson(c.req.raw, API_LIMIT)
    if (!body || typeof body !== 'object') throw new AnalytikError('body must be a JSON object')
    const { payment, duplicate } = await recordPayment(ctx, site, body as PaymentInput, 'api')
    return c.json({ ok: true, duplicate, payment, attributed: payment.sessionId !== null })
  })

  app.post('/v1/goals', async (c) => {
    const site = await siteByApiKey(ctx, bearer(c.req.raw))
    if (!site) throw new AnalytikError('invalid api key', 401)
    const body = ((await readJson(c.req.raw, API_LIMIT)) ?? {}) as Record<string, unknown>
    const name = clip(body.name, 100)
    const visitorId = body.visitorId
    const email = clip(body.email, 200)?.toLowerCase() ?? null
    if (!name || (!isId(visitorId) && !email)) throw new AnalytikError('name and visitorId or email are required')
    // A server-supplied email identifies the visitor even in strict mode: it comes from the integrator, not the browser.
    if (isId(visitorId) && email) {
      await ctx.storage.run('UPDATE visitors SET email = ? WHERE site_id = ? AND id = ?', [email, site.id, visitorId])
    }
    const [session] = await ctx.storage.query<{ id: string; visitor_id: string; exit_page: string | null }>(
      `SELECT s.id, s.visitor_id, s.exit_page FROM sessions s
       WHERE s.site_id = ? AND s.visitor_id = COALESCE(?, (SELECT v.id FROM visitors v WHERE v.site_id = ? AND v.email = ?
         ORDER BY v.first_seen DESC LIMIT 1))
       ORDER BY s.started_at DESC LIMIT 1`,
      [site.id, isId(visitorId) ? visitorId : null, site.id, email ?? ''],
    )
    if (!session) throw new AnalytikError('visitor not found', 404)
    const props = cleanProps(body.props)
    const now = ctx.now()
    await ctx.storage.batch([
      {
        sql: 'UPDATE sessions SET goals = goals + 1 WHERE site_id = ? AND id = ?',
        params: [site.id, session.id],
      },
      {
        sql: `INSERT INTO events (id, site_id, session_id, visitor_id, ts, type, name, path, props)
              VALUES (?, ?, ?, ?, ?, 'goal', ?, ?, ?)`,
        params: [
          randomId(20, ctx.random),
          site.id,
          session.id,
          session.visitor_id,
          now,
          name,
          session.exit_page,
          props ? JSON.stringify(props) : null,
        ],
      },
    ])
    return c.json({ ok: true, visitorId: session.visitor_id, sessionId: session.id })
  })

  app.post('/webhooks/:provider/:siteId', async (c) => {
    const provider = c.req.param('provider') as PaymentProvider
    const adapter = Object.hasOwn(ADAPTERS, provider) ? ADAPTERS[provider] : undefined
    if (!adapter) throw new AnalytikError('unknown provider', 404)
    const site = await getSite(ctx, c.req.param('siteId'))
    if (!site) throw new AnalytikError('site not found', 404)
    const secret = site.webhookSecrets[provider]
    if (!secret) throw new AnalytikError(`no ${provider} webhook secret configured for this site`)
    const body = await readText(c.req.raw, WEBHOOK_LIMIT)
    if (body === null) throw new AnalytikError('payload too large', 413)
    if (!(await adapter.verify({ headers: c.req.raw.headers, body, secret, now: ctx.now() }))) {
      throw new AnalytikError('invalid signature', 401)
    }
    let event: unknown
    try {
      event = JSON.parse(body)
    } catch {
      throw new AnalytikError('body must be JSON')
    }
    const input = adapter.toPayment(event)
    // Every other event type is acknowledged so the provider doesn't retry it.
    if (!input) return c.json({ ok: true, ignored: true })
    const { duplicate } = await recordPayment(ctx, site, input, provider)
    return c.json({ ok: true, duplicate })
  })
}
