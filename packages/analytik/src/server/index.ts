import { Hono } from 'hono'

import { adminMethod } from './auth'
import { AnalytikError, createContext } from './context'
import { runScheduled } from './email/notify'
import { ingest } from './ingest'
import { recordPayment } from './payments'
import { type AdminEnv, adminRoutes } from './routes/admin'
import { cronRoute } from './routes/cron'
import { publicRoutes } from './routes/public'
import { requireSite } from './sites'
import { createStatsApi } from './stats'
import type { Analytik, CreateAnalytikOptions } from './types'

export { AnalytikError } from './context'
export type * from './types'
export type * from '../shared/types'
export type { Storage, Statement, MigrationResult, Dialect } from '../storage/types'

/**
 * Creates the analytics server: a Hono app with the tracker, API, webhook and admin routes, plus the same
 * operations as functions for server code. Runs on Cloudflare Workers, Vercel, Bun and Node.
 */
export function createAnalytik(options: CreateAnalytikOptions): Analytik {
  const ctx = createContext(options)
  let migrated: Promise<unknown> | undefined
  const ready = () => {
    if (options.autoMigrate === false) return Promise.resolve()
    migrated ??= ctx.storage.migrate().catch((error: unknown) => {
      // Let the next request try again instead of caching the failure.
      migrated = undefined
      throw error
    })
    return migrated
  }

  const app = new Hono().basePath(ctx.basePath)
  app.onError((error, c) => {
    if (error instanceof AnalytikError) return c.json({ error: error.message }, error.status)
    console.error(error)
    return c.json({ error: 'internal error' }, 500)
  })
  app.notFound((c) => c.json({ error: `not found (routes are under ${ctx.basePath || '/'})` }, 404))

  app.get('/health', async (c) => {
    try {
      await ready()
      await ctx.storage.query('SELECT 1 AS ok')
      return c.json({ ok: true, dialect: ctx.storage.dialect })
    } catch (error) {
      // The message can name hosts or connection details: only admins and debug mode may see it.
      const detail = ctx.debug || (await adminMethod(ctx, c)) ? { error: (error as Error).message } : {}
      return c.json({ ok: false, dialect: ctx.storage.dialect, ...detail }, 503)
    }
  })
  app.use(async (c, next) => {
    await ready()
    await next()
    // Admin and stats responses must never be cached or sniffed; the tracker endpoint and favicons set their own.
    c.res.headers.set('x-content-type-options', 'nosniff')
    if (!c.res.headers.has('cache-control') && !/\/(event|attribution)$/.test(c.req.path)) {
      c.res.headers.set('cache-control', 'no-store')
    }
  })
  publicRoutes(app, ctx)
  cronRoute(app, ctx)
  const admin = new Hono<AdminEnv>()
  adminRoutes(admin, ctx)
  app.route('/', admin)
  // The same routes under `/v1`, the stable address for API keys; the dashboard keeps using the plain ones.
  const versioned = new Hono<AdminEnv>()
  adminRoutes(versioned, ctx)
  app.route('/v1', versioned)

  return {
    app,
    storage: ctx.storage,
    async ingest(input) {
      await ready()
      return ingest(ctx, input)
    },
    async recordPayment({ siteId, provider = 'api', ...input }) {
      await ready()
      return recordPayment(ctx, await requireSite(ctx, siteId), input, provider)
    },
    stats: createStatsApi(ctx, ready),
    async scheduled(options) {
      await ready()
      return runScheduled(ctx, options?.url)
    },
  }
}
