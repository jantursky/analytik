import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { version } from '../package.json'
import { createContext } from '../src/server/context'
import { KEY_ROUTES } from '../src/server/key-access'
import { DESCRIPTIONS, openApiDocument } from '../src/server/openapi'
import { type AdminEnv, adminRoutes } from '../src/server/routes/admin'
import { PASSWORD, type TestServer, testServer } from './helpers/server'

let server: TestServer
beforeEach(async () => {
  server = await testServer()
})
afterEach(() => server.close())

interface Param {
  name: string
  in: string
  required: boolean
  schema: { enum?: string[] }
}

interface Doc {
  openapi: string
  info: { version: string; 'x-api-version': string }
  paths: Record<string, Record<string, { 'x-analytik-scope': string; security: unknown[] }>>
  components: {
    securitySchemes: Record<string, unknown>
    schemas: Record<string, unknown>
    headers: Record<string, unknown>
  }
}

const keyed = async (json: Record<string, unknown>) => {
  const response = await server.admin('/api-keys', {
    method: 'POST',
    json: { label: 'Docs', password: PASSWORD, ...json },
  })
  return ((await response.json()) as { secret: string }).secret
}
const asKey = (secret: string, path: string) => server.request(path, { headers: { authorization: `Bearer ${secret}` } })
const document = () => openApiDocument() as unknown as Doc

const usable = KEY_ROUTES.filter((route) => route.access !== 'closed')
const toOpenApi = (path: string) => path.replace(/:([a-z]+)/gi, '{$1}')

describe('the OpenAPI document', () => {
  it('has an entry for every route a key can use, and none for anything else', () => {
    expect(Object.keys(DESCRIPTIONS).sort()).toEqual(usable.map((r) => `${r.method} ${r.path}`).sort())
  })

  it('lists key routes with their minimum scope and leaves closed ones out', () => {
    const doc = document()
    expect(doc.openapi).toBe('3.1.0')
    expect(doc.info).toMatchObject({ version, 'x-api-version': 'v1' })
    expect(doc.paths['/sites/{id}/overview']?.get?.['x-analytik-scope']).toBe('read')
    expect(doc.paths['/sites/{id}/funnels']?.post?.['x-analytik-scope']).toBe('write')
    expect(doc.paths['/openapi.json']?.get).toBeDefined()
    expect(doc.paths['/api-keys']).toBeUndefined()
    expect(doc.paths['/auth/login']).toBeUndefined()
    expect(doc.paths['/sites/{id}/webhooks']).toBeUndefined()
    expect(doc.paths['/sites']?.post).toBeUndefined()
  })

  it('declares the bearer scheme, the error schema and the limit headers, and applies the scheme everywhere', () => {
    const doc = document()
    expect(doc.components.securitySchemes).toHaveProperty('bearerKey')
    expect(doc.components.schemas).toHaveProperty('Error')
    expect(Object.keys(doc.components.headers)).toEqual(
      expect.arrayContaining(['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Retry-After']),
    )
    for (const methods of Object.values(doc.paths)) {
      for (const operation of Object.values(methods)) expect(operation.security).toEqual([{ bearerKey: [] }])
    }
  })

  it('is deterministic: sorted paths, the same object each time', () => {
    const paths = Object.keys(document().paths)
    expect(paths).toEqual([...paths].sort((a, b) => a.localeCompare(b)))
    expect(openApiDocument()).toBe(openApiDocument())
  })

  it('does not drift: every documented operation is registered and every usable route is documented', () => {
    const ctx = createContext({ storage: server.storage, admin: { verify: () => true } })
    const app = new Hono<AdminEnv>()
    adminRoutes(app, ctx)
    const registered = new Set(
      app.routes.filter((r) => r.method !== 'ALL').map((r) => `${r.method} ${toOpenApi(r.path)}`),
    )
    const documented = Object.entries(document().paths).flatMap(([path, methods]) =>
      Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`),
    )
    expect(documented.filter((d) => !registered.has(d))).toEqual([])
    expect(usable.map((r) => `${r.method} ${toOpenApi(r.path)}`).filter((r) => !documented.includes(r))).toEqual([])
  })

  it('serves every documented read route through /v1', async () => {
    const { site } = await server.createSite()
    const secret = await keyed({ scope: 'read' })
    for (const [path, methods] of Object.entries(document().paths)) {
      if (!methods.get || path === '/sites/{id}/favicon') continue
      const url = path.replace('{id}', site.id).replace('{sid}', 'none').replace('{fid}', 'none')
      // A required query parameter, such as the breakdown's dimension, gets its first allowed value.
      const required = ((methods.get as { parameters?: Param[] }).parameters ?? []).filter(
        (p) => p.in === 'query' && p.required,
      )
      const query = required.map((p) => `${p.name}=${p.schema.enum?.[0] ?? 'x'}`).join('&')
      const status = (await asKey(secret, `/v1${url}${query && `?${query}`}`)).status
      expect([200, 404], `${path} answered ${status}`).toContain(status)
    }
  })
})

describe('GET /v1/openapi.json', () => {
  it('answers a read key limited to one site, with no-store', async () => {
    const { site } = await server.createSite()
    const secret = await keyed({ scope: 'read', siteIds: [site.id] })
    const response = await asKey(secret, '/v1/openapi.json')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect((await response.json()) as Doc).toMatchObject({ openapi: '3.1.0' })
  })

  it('answers a write key and the admin', async () => {
    const secret = await keyed({ scope: 'write' })
    expect((await asKey(secret, '/v1/openapi.json')).status).toBe(200)
    expect((await server.admin('/v1/openapi.json')).status).toBe(200)
  })

  it('answers 401 without a credential or with a bad key', async () => {
    expect((await server.request('/v1/openapi.json')).status).toBe(401)
    expect((await asKey('anl_nope', '/v1/openapi.json')).status).toBe(401)
  })
})
