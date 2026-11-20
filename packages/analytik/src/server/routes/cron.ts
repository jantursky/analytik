import type { Hono } from 'hono'

import { timingSafeEqual } from '../../shared/crypto'
import { AnalytikError, type Context } from '../context'
import { ScheduledError, runScheduled } from '../email/notify'
import { runRetention } from '../retention'

/**
 * `/v1/cron`: runs the scheduled work for hosts with an HTTP cron (Vercel, GitHub Actions, any scheduler): retention
 * for every site that has a period, then the email work. `POST` is the documented call; `GET` is accepted too because
 * Vercel Cron only makes GET requests.
 */
export function cronRoute(app: Hono, ctx: Context): void {
  app.on(['GET', 'POST'], '/v1/cron', async (c) => {
    const secret = ctx.cronSecret
    const given = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '')?.[1]
    if (!secret || !given || !timingSafeEqual(given, secret)) throw new AnalytikError('invalid cron secret', 401)
    const retention = await runRetention(ctx)
    try {
      return c.json({ ok: true, ...(await runScheduled(ctx, new URL(c.req.url).origin)), retention })
    } catch (error) {
      if (!(error instanceof ScheduledError)) throw error
      console.error('analytik: scheduled email work failed', error.errors)
      // What did go out is reported, so a retry knows the rest.
      return c.json({ ok: false, error: error.message, ...error.result, retention }, 500)
    }
  })
}
