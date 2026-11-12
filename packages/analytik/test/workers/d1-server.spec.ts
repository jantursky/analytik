import { build } from 'esbuild'
import { Miniflare } from 'miniflare'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// The server and the D1 adapter on a real workerd with a real D1 binding. Not part of `bun run check`:
// run with `bun run test:workers`. (Named .spec.ts so the default test run does not pick it up.)
const BASE = 'https://analytics.example.com/api'
const PASSWORD = 'workers-test-password'

let mf: Miniflare | undefined

beforeAll(async () => {
  const bundle = await build({
    entryPoints: ['test/workers/worker.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    mainFields: ['module', 'main'],
    conditions: ['workerd', 'worker', 'browser'],
  })
  const [file] = bundle.outputFiles
  const script = file?.text ?? ''
  mf = new Miniflare({
    modules: true,
    script,
    compatibilityDate: '2026-01-01',
    compatibilityFlags: ['nodejs_compat'],
    d1Databases: { DB: 'analytik-test' },
  })
  await mf.ready
}, 60_000)

afterAll(async () => {
  await mf?.dispose()
})

const call = (path: string, init: RequestInit = {}) => mf!.dispatchFetch(`${BASE}${path}`, init as never)

describe('server on workerd with D1', () => {
  it('migrates, ingests an event, reads the overview and signs the admin in', async () => {
    const health = await call('/health')
    expect(await health.json()).toMatchObject({ ok: true, dialect: 'sqlite' })

    const wrong = await call('/auth/login', { method: 'POST', body: JSON.stringify({ password: 'nope' }) })
    expect(wrong.status).toBe(401)
    const login = await call('/auth/login', { method: 'POST', body: JSON.stringify({ password: PASSWORD }) })
    expect(login.status).toBe(200)
    const { token } = (await login.json()) as { token: string }
    const auth = { authorization: `Bearer ${token}` }

    const created = await call('/sites', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ name: 'Example', domain: 'example.com' }),
    })
    expect(created.status).toBeLessThan(300)
    const { site } = (await created.json()) as { site: { id: string } }

    const sent = await call('/event', {
      method: 'POST',
      headers: {
        'content-type': 'text/plain',
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36',
        'cf-connecting-ip': '203.0.113.7',
        origin: 'https://example.com',
      },
      body: JSON.stringify({ w: site.id, t: 'pageview', u: 'https://example.com/pricing' }),
    })
    expect(sent.status).toBe(202)

    const day = (offset: number): string => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
    const overview = await call(`/sites/${site.id}/overview?from=${day(-1)}&to=${day(1)}&tz=UTC`, { headers: auth })
    expect(overview.status).toBe(200)
    const body = (await overview.json()) as { visitors: { value: number }; pageviews: { value: number } }
    expect(body.pageviews.value).toBe(1)
    expect(body.visitors.value).toBe(1)
  })
})
