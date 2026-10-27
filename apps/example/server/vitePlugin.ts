import type { Connect, Plugin } from 'vite'

import { sendResponse, toRequest } from './node.js'

type Handle = (request: Request) => Promise<Response>

const middleware =
  (load: () => Promise<Handle>): Connect.NextHandleFunction =>
  async (req, res, next) => {
    if (!/^\/api(?:[/?]|$)/.test(req.url ?? '')) {
      next()
      return
    }
    try {
      const handle = await load()
      await sendResponse(res, await handle(await toRequest(req)))
    } catch (error) {
      next(error)
    }
  }

/** Mounts the same handler as the Vercel function on the dev and preview servers. */
export const demoApi = (): Plugin => ({
  name: 'analytik-demo-api',
  configureServer(server) {
    server.middlewares.use(
      // Loaded through Vite so the dev server resolves `analytik/*` to the library source.
      middleware(async () => ((await server.ssrLoadModule('/server/demo.ts')) as { handle: Handle }).handle),
    )
  },
  configurePreviewServer(server) {
    server.middlewares.use(middleware(async () => (await import('./demo.js')).handle))
  },
})
