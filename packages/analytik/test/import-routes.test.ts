import { afterEach, describe, expect, it } from 'vitest'

import { IMPORT_BODY_LIMIT, MAX_EVENTS, MAX_VISITS } from '../src/server/import/validate'
import type { ImportResult, ImportSummary } from '../src/shared/import/types'
import { storageKinds } from './helpers/databases'
import { START, type TestServer, testServer } from './helpers/server'

const visit = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  visitor: `person-${id}`,
  browser: 'Chrome',
  country: 'SK',
  referrer: 'https://news.ycombinator.com/',
  events: [
    { ts: START - 3_600_000, type: 'pageview', path: '/' },
    { ts: START - 3_500_000, type: 'goal', name: 'signup', path: '/pricing', props: { plan: 'pro' } },
  ],
  ...extra,
})

describe.each(storageKinds())('import routes on %s', (kind) => {
  let server: TestServer

  afterEach(async () => {
    await server.storage.close?.()
  })

  const post = (siteId: string, json: unknown, query = '') =>
    server.admin(`/sites/${siteId}/import${query}`, { method: 'POST', json })

  it('imports a chunk, lists it, ignores a repeat and removes it', async () => {
    server = await testServer(kind)
    const { site } = await server.createSite()

    const first = await post(site.id, { source: 'umami', visits: [visit('a'), visit('b')] })
    expect(first.status).toBe(200)
    expect((await first.json()) as ImportResult).toEqual({
      visits: 2,
      events: 4,
      existing: { visits: 0, events: 0 },
      tooOld: { visits: 0, events: 0 },
    })

    const repeat = (await (
      await post(site.id, { source: 'umami', visits: [visit('a'), visit('b')] })
    ).json()) as ImportResult
    expect(repeat).toMatchObject({ visits: 0, events: 0, existing: { visits: 2, events: 4 } })

    const list = await server.adminJson<ImportSummary[]>(`/sites/${site.id}/imports`)
    expect(list).toEqual([{ source: 'umami', visits: 2, events: 4, from: START - 3_600_000, to: START - 3_600_000 }])

    const overview = await server.adminJson<{ sessions: { value: number } }>(
      `/sites/${site.id}/overview?from=2026-03-16&to=2026-03-16`,
    )
    expect(overview.sessions.value).toBe(2)

    const removed = await server.admin(`/sites/${site.id}/imports/umami`, { method: 'DELETE' })
    expect(await removed.json()).toEqual({ visits: 2, events: 4, visitors: 2 })
    expect(await server.adminJson<ImportSummary[]>(`/sites/${site.id}/imports`)).toEqual([])
  })

  it('needs an admin and refuses a share link', async () => {
    server = await testServer(kind)
    const { site } = await server.createSite({ shareToken: true })
    const body = JSON.stringify({ source: 'umami', visits: [visit('a')] })
    expect((await server.request(`/sites/${site.id}/import`, { method: 'POST', body })).status).toBe(401)
    expect((await server.request(`/sites/${site.id}/imports`)).status).toBe(401)
    expect((await server.request(`/sites/${site.id}/imports/umami`, { method: 'DELETE' })).status).toBe(401)
    const { shareToken } = await server.adminJson<{ shareToken: string }>(`/sites/${site.id}`)
    const shared = await server.request(`/sites/${site.id}/import?share=${shareToken}`, { method: 'POST', body })
    expect(shared.status).toBe(401)
    expect((await server.request(`/sites/${site.id}/imports?share=${shareToken}`)).status).toBe(401)
  })

  it('refuses requests that are too large, and a body past the size limit', async () => {
    server = await testServer(kind)
    const { site } = await server.createSite()
    const many = Array.from({ length: MAX_VISITS + 1 }, (_, index) => visit(`v${index}`))
    expect((await post(site.id, { source: 'umami', visits: many })).status).toBe(413)
    const crowded = visit('big', {
      events: Array.from({ length: MAX_EVENTS + 1 }, (_, index) => ({
        ts: START - index,
        type: 'pageview',
        path: '/',
      })),
    })
    expect((await post(site.id, { source: 'umami', visits: [crowded] })).status).toBe(413)
    const huge = visit('huge', { city: 'x'.repeat(IMPORT_BODY_LIMIT) })
    expect((await post(site.id, { source: 'umami', visits: [huge] })).status).toBe(413)
    expect(await server.adminJson<ImportSummary[]>(`/sites/${site.id}/imports`)).toEqual([])
  })

  it.each([
    [{ source: 'matomo', visits: [visit('a')] }, 'source must be'],
    [{ source: 'umami', visits: [] }, 'visits must be a list'],
    [{ source: 'umami', visits: [{ ...visit('a'), id: '' }] }, 'visits[0].id is required'],
    [{ source: 'umami', visits: [{ ...visit('a'), events: [] }] }, 'visits[0].events must be a list'],
    [
      { source: 'umami', visits: [visit('a', { events: [{ ts: 5, type: 'pageview', path: '/' }] })] },
      'visits[0].events[0].ts must be unix milliseconds',
    ],
    [
      { source: 'umami', visits: [visit('a', { events: [{ ts: START, type: 'ping', path: '/' }] })] },
      'visits[0].events[0].type must be pageview or goal',
    ],
    [
      { source: 'umami', visits: [visit('a', { events: [{ ts: START, type: 'goal', path: '/' }] })] },
      'visits[0].events[0].name is required',
    ],
    [{ source: 'umami', visits: [visit('a', { durationMs: -1 })] }, 'durationMs must be'],
  ])('rejects a malformed chunk and stores nothing (%#)', async (payload, message) => {
    server = await testServer(kind)
    const { site } = await server.createSite()
    const response = await post(site.id, payload)
    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: string }).error).toContain(message)
    expect(await server.adminJson<ImportSummary[]>(`/sites/${site.id}/imports`)).toEqual([])
  })

  it('stores only known fields and removes only the named source', async () => {
    server = await testServer(kind)
    const { site } = await server.createSite()
    await post(site.id, { source: 'umami', visits: [visit('a', { imported: 'tracker', lat: 1, id2: 'x' })] })
    await post(site.id, { source: 'simple-analytics', visits: [visit('a')] })
    const rows = await server.storage.query<{ imported: string; lat: number | null }>(
      'SELECT imported, lat FROM sessions WHERE site_id = ? ORDER BY imported',
      [site.id],
    )
    expect(rows).toEqual([
      { imported: 'simple-analytics', lat: null },
      { imported: 'umami', lat: null },
    ])
    expect((await server.admin(`/sites/${site.id}/imports/matomo`, { method: 'DELETE' })).status).toBe(404)
    await server.admin(`/sites/${site.id}/imports/umami`, { method: 'DELETE' })
    expect((await server.adminJson<ImportSummary[]>(`/sites/${site.id}/imports`)).map((item) => item.source)).toEqual([
      'simple-analytics',
    ])
  })
})
