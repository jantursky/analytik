import { Hono } from 'hono'

import { AnalytikError, createContext } from './context'
import { ingest } from './ingest'
import { recordPayment } from './payments'
import { type AdminEnv, adminRoutes } from './routes/admin'
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
  app.notFound((c) => c.json({ error: 'not found' }, 404))

  app.get('/health', async (c) => {
    try {
      await ready()
      await ctx.storage.query('SELECT 1 AS ok')
      return c.json({ ok: true, dialect: ctx.storage.dialect })
    } catch {
      return c.json({ ok: false, dialect: ctx.storage.dialect }, 503)
    }
  })
  app.use(async (_c, next) => {
    await ready()
    await next()
  })
  publicRoutes(app, ctx)
  const admin = new Hono<AdminEnv>()
  adminRoutes(admin, ctx)
  app.route('/', admin)

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
  }
}
