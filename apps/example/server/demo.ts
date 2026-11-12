import { seedDemo } from 'analytik/migrate'
import { createAnalytik } from 'analytik/server'
import { memoryStorage } from 'analytik/storage/memory'

import { API_BASE, DEMO_SHARE_TOKEN, SITE_ID } from '../src/config.js'
import { createSimulator, type Simulator } from './simulator.js'

type Handle = (request: Request) => Promise<Response>

const DOMAIN = 'demo.analytik.dev'

const sha256Hex = async (text: string): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')

// The demo is public, so the only writes visitors may make are the tracker's own.
const WRITABLE = new Set([
  `${API_BASE}/event`,
  `${API_BASE}/attribution`,
  `${API_BASE}/auth/login`,
  `${API_BASE}/auth/logout`,
])
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export const isAllowed = (method: string, pathname: string): boolean =>
  SAFE_METHODS.has(method) || (method === 'POST' && WRITABLE.has(pathname.replace(/\/+$/, '')))

// Cold start: in-memory database, seeded with a few weeks of traffic ending now, plus a trickle of live visitors
// while the instance is warm. Locally, the debug tools are on for generating test data.
const boot = async (local: boolean): Promise<{ handle: Handle; simulator: Simulator }> => {
  const storage = memoryStorage()
  await storage.migrate()
  await seedDemo(storage, { siteId: SITE_ID, domain: DOMAIN, now: Date.now() })
  // A fixed share link, so the read-only dashboard can be opened in the demo (the demo's own API refuses to make one).
  await storage.run(
    'INSERT INTO share_links (id, site_id, token_hash, label, views, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ['sl_demo', SITE_ID, await sha256Hex(DEMO_SHARE_TOKEN), 'Demo link', '[]', Date.now()],
  )
  const analytik = createAnalytik({
    storage,
    admin: { verify: () => Promise.resolve(true) },
    privacy: { mode: 'strict' },
    basePath: API_BASE,
    debug: local,
    // The demo is read-only and not meant to be updated.
    updateCheck: false,
  })
  return {
    handle: (request) => Promise.resolve(analytik.app.fetch(request)),
    simulator: createSimulator({ analytik, siteId: SITE_ID, origin: `https://${DOMAIN}` }),
  }
}

const instances = new Map<boolean, ReturnType<typeof boot>>()

const serve = async (request: Request, local: boolean): Promise<Response> => {
  let ready = instances.get(local)
  if (!ready) {
    ready = boot(local).catch((error: unknown) => {
      instances.delete(local)
      throw error
    })
    instances.set(local, ready)
  }
  const demo = await ready
  demo.simulator.touch()
  return demo.handle(request)
}

/** The public demo: read-only apart from the tracker and login. */
export const handle: Handle = async (request) => {
  const { pathname } = new URL(request.url)
  if (!isAllowed(request.method, pathname)) {
    return Response.json(
      { error: 'This demo is read-only. Run it locally with "bun run dev" to try this.' },
      { status: 403 },
    )
  }
  return serve(request, false)
}

/** The dev server's demo: every write allowed and the debug tools on, for trying settings and test data. */
export const localHandle: Handle = (request) => serve(request, true)
