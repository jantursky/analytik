import { createAnalytik } from '../../src/server'
import { d1Storage, type D1Like } from '../../src/storage/d1'

/** The server app on a D1 binding, the way a Worker deploys it; bundled and run on workerd by d1-server.spec.ts. */
export default {
  fetch(request: Request, env: { DB: D1Like }): Promise<Response> | Response {
    const analytik = createAnalytik({
      storage: d1Storage(env.DB),
      admin: { password: 'workers-test-password', secret: 'workers-test-secret-long-enough-123456' },
      trustProxy: 'cloudflare',
      updateCheck: false,
    })
    return analytik.app.fetch(request)
  },
}
