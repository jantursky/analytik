import { createAnalytik } from 'analytik/server'
import { resendSender } from 'analytik/email'
import { d1Storage } from 'analytik/storage/d1'
import { withDashboard } from 'analytik/standalone'

interface Env {
  DB: D1Database
  ADMIN_PASSWORD: string
  SESSION_SECRET: string
  // Optional: set both to get payment alerts, a summary and a tracker-down warning by email (Settings → Email).
  RESEND_API_KEY?: string
  EMAIL_FROM?: string
  EMAIL_TO?: string
}

function create(env: Env) {
  const analytik = createAnalytik({
    storage: d1Storage(env.DB),
    admin: { password: env.ADMIN_PASSWORD, secret: env.SESSION_SECRET },
    email:
      env.RESEND_API_KEY && env.EMAIL_FROM
        ? { send: resendSender({ apiKey: env.RESEND_API_KEY }), from: env.EMAIL_FROM, to: env.EMAIL_TO }
        : undefined,
  })
  return { analytik, handler: withDashboard<[Env, ExecutionContext]>(analytik.app) }
}

// Built once per isolate, not once per request.
let instance: ReturnType<typeof create> | undefined

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    instance ??= create(env)
    return instance.handler.fetch(request, env, ctx)
  },
  // The hourly cron in wrangler.jsonc: sends the summary when it is due and checks that tracking still works.
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    instance ??= create(env)
    ctx.waitUntil(instance.analytik.scheduled())
  },
}
