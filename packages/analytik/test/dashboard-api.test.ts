import { describe, expect, it, vi } from 'vitest'

import { ApiError, createApiClient, queryParams } from '../src/dashboard/api'
import { fakeApi, funnel, overview, site } from './dashboard-fixtures'

const query = { from: Date.UTC(2026, 9, 1), to: Date.UTC(2026, 9, 8), interval: 'day' as const, tz: 'Europe/Berlin' }

describe('queryParams', () => {
  it('encodes ISO dates, interval, tz, filters and extras, skipping empty values', () => {
    const params = queryParams({
      ...query,
      filters: { country: 'DE', channel: 'Organic Search', page: undefined, city: '' },
      cursor: null,
      name: 'signup',
    })
    expect(params.toString()).toBe(
      'from=2026-10-01T00%3A00%3A00.000Z&to=2026-10-08T00%3A00%3A00.000Z&interval=day&tz=Europe%2FBerlin&name=signup&country=DE&channel=Organic+Search',
    )
  })
})

describe('createApiClient', () => {
  it('calls the admin routes with cookies and typed results', async () => {
    const api = fakeApi()
    const client = createApiClient('/api/', api.fetcher)
    expect(await client.sites()).toHaveLength(2)
    expect(await client.overview('site_1', query)).toEqual(overview)
    await client.breakdown('site 1', 'country', { ...query, filters: { channel: 'Direct' } })
    await client.funnel('site_1', 'f1', query)
    await client.session('site_1', 'sess/1')
    expect((await client.createFunnel('site_1', { name: 'B', steps: funnel.steps })).id).toBe('f2')
    await client.deleteFunnel('site_1', 'f2')
    await client.updateSite('site_1', { name: 'Renamed', webhookSecrets: { stripe: 'whsec' } })
    await client.purge('site_1', Date.UTC(2025, 0, 1))
    expect(api.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /sites',
      'GET /sites/site_1/overview',
      'GET /sites/site%201/breakdown',
      'GET /sites/site_1/funnels/f1',
      'GET /sites/site_1/sessions/sess%2F1',
      'POST /sites/site_1/funnels',
      'DELETE /sites/site_1/funnels/f2',
      'PATCH /sites/site_1',
      'DELETE /sites/site_1/data',
    ])
    expect(api.requests[2]?.params).toMatchObject({ dimension: 'country', channel: 'Direct', tz: 'Europe/Berlin' })
    expect(api.requests[7]?.body).toEqual({ name: 'Renamed', webhookSecrets: { stripe: 'whsec' } })
    expect(api.requests[8]?.params).toEqual({ before: '2025-01-01T00:00:00.000Z' })
    expect(client.exportUrl('site_1', 'csv')).toBe('/api/sites/site_1/export?format=csv')
  })

  it('sends JSON bodies with credentials', async () => {
    const fetcher = vi.fn(() => Promise.resolve(Response.json({ ok: true })))
    const client = createApiClient('https://stats.example.net/api', fetcher)
    await client.login('secret')
    await client.me()
    expect(fetcher.mock.calls).toEqual([
      [
        'https://stats.example.net/api/auth/login',
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: '{"password":"secret"}',
        },
      ],
      [
        'https://stats.example.net/api/auth/me',
        { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' }, body: undefined },
      ],
    ])
  })

  it('rejects with ApiError carrying the status and server message', async () => {
    const api = fakeApi({ 'GET /sites/:id': () => new Response('plain failure', { status: 500 }) })
    const client = createApiClient('/api', api.fetcher)
    await expect(client.login('wrong')).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      message: 'Wrong password',
    })
    const error = await client.site('site_1').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 500, message: 'HTTP 500' })
  })

  it('covers the remaining routes', async () => {
    const api = fakeApi({
      'GET /sites/:id': () => site,
      'DELETE /sites/:id': () => new Response(null, { status: 204 }),
    })
    const client = createApiClient('/api', api.fetcher)
    expect(await client.site('site_1')).toEqual(site)
    expect(await client.deleteSite('site_1')).toBeUndefined()
    expect(await client.rotateKey('site_1')).toEqual({ apiKey: 'ak_live_123' })
    expect((await client.createSite({ name: 'N', domain: 'n.org' })).id).toBe('site_new')
    await client.timeseries('site_1', query)
    await client.realtime('site_1')
    await client.sessions('site_1', { ...query, cursor: 'c2' })
    await client.events('site_1', { ...query, name: 'signup' })
    await client.funnels('site_1')
    await client.payments('site_1', query)
    await client.rematch('site_1')
    await client.logout()
    expect(api.find('GET', '/sites/site_1/sessions')[0]?.params.cursor).toBe('c2')
    expect(api.requests.at(-1)?.path).toBe('/auth/logout')
  })
})
