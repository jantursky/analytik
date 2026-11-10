import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { sha256Hex } from '../src/shared/crypto'
import { DAY } from '../src/shared/time'
import type { ShareLink } from '../src/shared/types'
import { type TestServer, testServer } from './helpers/server'

let server: TestServer
beforeEach(async () => {
  server = await testServer()
})
afterEach(() => server.close())

const create = async (siteId: string, json: Record<string, unknown> = {}) => {
  const response = await server.admin(`/sites/${siteId}/share-links`, { method: 'POST', json })
  return { response, ...((await response.clone().json()) as { link: ShareLink; token: string }) }
}

describe('share links', () => {
  it('open the read-only stats of their site, and nothing else', async () => {
    const { site } = await server.createSite()
    const other = (await server.createSite({ domain: 'other.com' })).site
    const { response, link, token } = await create(site.id, { label: 'Board' })
    expect(response.status).toBe(201)
    expect(link).toMatchObject({ siteId: site.id, label: 'Board', views: [], expiresAt: null, revokedAt: null })
    expect(token.length).toBeGreaterThanOrEqual(43)

    for (const path of ['overview', 'timeseries', 'realtime', 'sessions', 'events', 'bots', 'funnels']) {
      expect((await server.request(`/sites/${site.id}/${path}?share=${token}`)).status, path).toBe(200)
    }
    expect((await server.request(`/sites/${site.id}/breakdown?share=${token}&dimension=page`)).status).toBe(200)
    // Not another site, not the site record, settings, export, payments, session details or any write.
    expect((await server.request(`/sites/${other.id}/overview?share=${token}`)).status).toBe(401)
    for (const path of ['', '/export', '/payments', '/share-links', '/imports', '/sessions/x']) {
      expect((await server.request(`/sites/${site.id}${path}?share=${token}`)).status, path).toBe(401)
    }
    expect(
      (await server.request(`/sites/${site.id}/share-links?share=${token}`, { method: 'POST', body: '{}' })).status,
    ).toBe(401)
    expect(
      (await server.request(`/sites/${site.id}/funnels?share=${token}`, { method: 'POST', body: '{}' })).status,
    ).toBe(401)
    expect((await server.request(`/sites/${site.id}/overview?share=${token}x`)).status).toBe(401)
    expect((await server.request(`/sites/${site.id}/overview?share=short`)).status).toBe(401)
  })

  it('store only the hash of the token and show the token once', async () => {
    const { site } = await server.createSite()
    const { token } = await create(site.id)
    const rows = await server.rows<{ token_hash: string }>('SELECT token_hash FROM share_links')
    expect(rows).toEqual([{ token_hash: await sha256Hex(token) }])
    expect(JSON.stringify(rows)).not.toContain(token)
    const list = await server.adminJson<ShareLink[]>(`/sites/${site.id}/share-links`)
    expect(list).toHaveLength(1)
    expect(JSON.stringify(list)).not.toContain(token)
    expect(list[0]).not.toHaveProperty('token')
  })

  it('stop working at once when revoked', async () => {
    const { site } = await server.createSite()
    const { link, token } = await create(site.id)
    expect((await server.request(`/sites/${site.id}/overview?share=${token}`)).status).toBe(200)
    expect((await server.admin(`/sites/${site.id}/share-links/${link.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await server.request(`/sites/${site.id}/overview?share=${token}`)).status).toBe(401)
    expect(
      (await server.request(`/sites/${site.id}/overview`, { headers: { 'x-analytik-share': token } })).status,
    ).toBe(401)
    const [listed] = await server.adminJson<ShareLink[]>(`/sites/${site.id}/share-links`)
    expect(listed?.revokedAt).toBe(server.now)
    expect((await server.admin(`/sites/${site.id}/share-links/nope`, { method: 'DELETE' })).status).toBe(404)
  })

  it('expire when asked to', async () => {
    const { site } = await server.createSite()
    const { link, token } = await create(site.id, { expiresInDays: 2 })
    expect(link.expiresAt).toBe(server.now + 2 * DAY)
    server.advance(DAY)
    expect((await server.request(`/sites/${site.id}/overview?share=${token}`)).status).toBe(200)
    server.advance(DAY)
    expect((await server.request(`/sites/${site.id}/overview?share=${token}`)).status).toBe(401)
  })

  it('can be limited to chosen views', async () => {
    const { site } = await server.createSite()
    const { token } = await create(site.id, { views: ['sessions', 'bots'] })
    const status = async (path: string) => (await server.request(`/sites/${site.id}/${path}?share=${token}`)).status
    expect(await status('sessions')).toBe(200)
    expect(await status('bots')).toBe(200)
    expect(await status('overview')).toBe(401)
    expect(await status('events')).toBe(401)
    expect(await status('funnels')).toBe(401)
  })

  describe('as a Bearer token (the Stats API)', () => {
    const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } })

    it('reads every readable route, like the other two forms, and never caches publicly', async () => {
      const { site } = await server.createSite()
      const { token } = await create(site.id)
      for (const path of [
        'overview',
        'timeseries',
        'realtime',
        'sessions',
        'events',
        'bots',
        'funnels',
        'breakdown?dimension=page',
        'properties?name=signup',
      ]) {
        const response = await server.request(`/sites/${site.id}/${path}`, bearer(token))
        expect(response.status, path).toBe(200)
        expect(response.headers.get('cache-control'), path).not.toContain('public')
      }
      // The address form still caches publicly, the header forms do not.
      const address = await server.request(`/sites/${site.id}/overview?share=${token}`)
      expect(address.headers.get('cache-control')).toContain('public')
    })

    it('stops when the link is revoked, expired, for another site or limited to other views', async () => {
      const { site } = await server.createSite()
      const other = (await server.createSite({ domain: 'other.com' })).site
      const { token } = await create(site.id, { expiresInDays: 1 })
      const limited = (await create(site.id, { views: ['bots'] })).token
      expect((await server.request(`/sites/${other.id}/overview`, bearer(token))).status).toBe(401)
      expect((await server.request(`/sites/${site.id}/overview`, bearer(limited))).status).toBe(401)
      expect((await server.request(`/sites/${site.id}/bots`, bearer(limited))).status).toBe(200)
      server.advance(2 * DAY)
      expect((await server.request(`/sites/${site.id}/overview`, bearer(token))).status).toBe(401)
      const fresh = await create(site.id)
      await server.admin(`/sites/${site.id}/share-links/${fresh.link.id}`, { method: 'DELETE' })
      expect((await server.request(`/sites/${site.id}/overview`, bearer(fresh.token))).status).toBe(401)
    })

    it('never opens a write, settings, payments, export or session details', async () => {
      const { site } = await server.createSite()
      const { token } = await create(site.id)
      const patch = await server.request(`/sites/${site.id}`, {
        method: 'PATCH',
        body: '{}',
        ...bearer(token),
      })
      expect(patch.status).toBe(401)
      for (const path of ['', '/payments', '/export', '/sessions/x', '/share-links', '/webhooks']) {
        expect((await server.request(`/sites/${site.id}${path}`, bearer(token))).status, path).toBe(401)
      }
    })

    it('leaves the admin Bearer token an admin token, never a link lookup', async () => {
      const { site } = await server.createSite()
      expect((await server.request(`/sites/${site.id}/overview`, bearer(server.token))).status).toBe(200)
      expect((await server.request(`/sites/${site.id}`, bearer(server.token))).status).toBe(200)
      expect((await server.request(`/sites/${site.id}/overview`, bearer('admin.1.forged'))).status).toBe(401)
    })
  })

  it('refuse a link whose stored views cannot be read', async () => {
    const { site } = await server.createSite()
    const { token } = await create(site.id, { views: ['bots'] })
    await server.storage.run("UPDATE share_links SET views = 'not json'")
    expect((await server.request(`/sites/${site.id}/overview?share=${token}`)).status).toBe(401)
    expect((await server.adminJson<ShareLink[]>(`/sites/${site.id}/share-links`))[0]?.views).toEqual([])
  })

  it('validate what is asked for', async () => {
    const { site } = await server.createSite()
    for (const json of [
      { label: 5 },
      { label: 'x'.repeat(81) },
      { views: ['settings'] },
      { views: 'overview' },
      { expiresInDays: 0 },
      { expiresInDays: 1.5 },
      { expiresInDays: 'soon' },
    ]) {
      expect((await create(site.id, json)).response.status, JSON.stringify(json)).toBe(400)
    }
    expect((await create(site.id, { expiresInDays: null, views: ['overview', 'overview'] })).link.views).toEqual([
      'overview',
    ])
  })

  it('are capped per site and need an admin', async () => {
    const { site } = await server.createSite()
    for (let i = 0; i < 50; i++) await create(site.id)
    expect((await create(site.id)).response.status).toBe(400)
    expect((await server.request(`/sites/${site.id}/share-links`)).status).toBe(401)
    expect((await server.request(`/sites/${site.id}/share-links`, { method: 'POST', body: '{}' })).status).toBe(401)
  })

  it('are removed with their site', async () => {
    const { site } = await server.createSite()
    await create(site.id)
    await server.admin(`/sites/${site.id}`, {
      method: 'DELETE',
      json: { confirm: site.domain, password: 'correct horse battery staple' },
    })
    expect(await server.rows('SELECT id FROM share_links')).toEqual([])
  })

  describe('caching', () => {
    it('lets a CDN keep a response for a minute when the token is in the address', async () => {
      const { site } = await server.createSite()
      const { token } = await create(site.id)
      const shared = await server.request(`/sites/${site.id}/overview?share=${token}`)
      expect(shared.headers.get('cache-control')).toBe('public, s-maxage=60')
      const live = await server.request(`/sites/${site.id}/realtime?share=${token}`)
      expect(live.headers.get('cache-control')).toBe('public, s-maxage=10')
    })

    it('never caches publicly a header token, an admin request or an error', async () => {
      const { site } = await server.createSite()
      const { token } = await create(site.id)
      const header = await server.request(`/sites/${site.id}/overview`, { headers: { 'x-analytik-share': token } })
      expect(header.status).toBe(200)
      expect(header.headers.get('cache-control')).toBe('no-store')
      expect((await server.admin(`/sites/${site.id}/overview`)).headers.get('cache-control')).toBe('no-store')
      const bad = await server.request(`/sites/${site.id}/breakdown?share=${token}&dimension=nope`)
      expect(bad.status).toBe(400)
      expect(bad.headers.get('cache-control')).toBe('no-store')
      expect(
        (await server.request(`/sites/${site.id}/overview?share=${'x'.repeat(43)}`)).headers.get('cache-control'),
      ).toBe('no-store')
    })
  })

  it('leave the older site-wide share token working', async () => {
    const { site } = await server.createSite({ shareToken: true })
    const old = (await server.adminJson<{ shareToken: string }>(`/sites/${site.id}`)).shareToken
    const response = await server.request(`/sites/${site.id}/overview?share=${old}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})
