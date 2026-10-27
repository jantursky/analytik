import { createAnalytik } from 'analytik/server'
import { d1Storage } from 'analytik/storage/d1'
import { withDashboard } from 'analytik/standalone'

interface Env {
  DB: D1Database
  ADMIN_PASSWORD: string
  SESSION_SECRET: string
}

// Built once per isolate, not once per request.
let handler: ReturnType<typeof withDashboard<[Env, ExecutionContext]>> | undefined

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    handler ??= withDashboard(
      createAnalytik({
        storage: d1Storage(env.DB),
        admin: { password: env.ADMIN_PASSWORD, secret: env.SESSION_SECRET },
      }).app,
    )
    return handler.fetch(request, env, ctx)
  },
}
