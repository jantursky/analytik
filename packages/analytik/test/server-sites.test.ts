import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Site } from '../src/shared/types'
import { storageKinds } from './helpers/databases'
import { CHROME, PASSWORD, type TestServer, testServer } from './helpers/server'

let server: TestServer

beforeEach(async () => {
  server = await testServer()
})

afterEach(async () => {
  await server.close()
})

describe('site management', () => {
  it('creates a site with defaults and returns the API key once', async () => {
    const { site, apiKey } = await server.adminJson<{ site: Site; apiKey: string }>('/sites', {
      method: 'POST',
      json: { domain: 'https://www.Example.com/landing' },
    })
    expect(apiKey).toMatch(/^ak_[0-9a-z]{32}$/)
    expect(site).toMatchObject({
      name: 'example.com',
      domain: 'example.com',
      timezone: 'UTC',
      currency: 'USD',
      privacyMode: 'strict',
      retentionDays: null,
      allowLocalhost: false,
      paused: false,
      ignoredIps: [],
      shareToken: null,
      webhooks: { stripe: false, dodo: false, lemonsqueezy: false },
    })
    expect(JSON.stringify(site)).not.toContain(apiKey)
    const [row] = await server.rows<{ api_key_hash: string }>('SELECT api_key_hash FROM sites')
    expect(row?.api_key_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('uses the configured default privacy mode and the domain as fallback name', async () => {
    const custom = await testServer('memory', { privacy: { mode: 'persistent' } })
    const { site } = await custom.adminJson<{ site: Site }>('/sites', { method: 'POST', json: { domain: 'shop.io' } })
    expect(site).toMatchObject({ name: 'shop.io', privacyMode: 'persistent' })
    await custom.close()
  })

  it('lists, reads, updates and deletes sites', async () => {
    const { site } = await server.createSite()
    await server.createSite({ domain: 'second.dev', name: 'Second' })
    expect((await server.adminJson<Site[]>('/sites')).map((item) => item.name)).toEqual(['Example', 'Second'])
    expect(await server.adminJson<Site>(`/sites/${site.id}`)).toMatchObject({ id: site.id })

    const updated = await server.adminJson<Site>(`/sites/${site.id}`, {
      method: 'PATCH',
      json: {
        name: '  Renamed  ',
        timezone: 'Europe/Bratislava',
        currency: 'eur',
        privacyMode: 'enriched',
        retentionDays: 90,
        allowLocalhost: true,
        ignoredIps: ['10.0.0.1', '2001:db8::1'],
        webhookSecrets: { stripe: 'whsec_x', dodo: 'whsec_y' },
      },
    })
    expect(updated).toMatchObject({
      name: 'Renamed',
      timezone: 'Europe/Bratislava',
      currency: 'EUR',
      privacyMode: 'enriched',
      retentionDays: 90,
      allowLocalhost: true,
      ignoredIps: ['10.0.0.1', '2001:db8::1'],
      webhooks: { stripe: true, dodo: true, lemonsqueezy: false },
    })
    expect(JSON.stringify(updated)).not.toContain('whsec_')
    const cleared = await server.adminJson<Site>(`/sites/${site.id}`, {
      method: 'PATCH',
      json: { webhookSecrets: { stripe: null }, retentionDays: null },
    })
    expect(cleared).toMatchObject({ webhooks: { stripe: false, dodo: true }, retentionDays: null })
    expect(await server.adminJson<Site>(`/sites/${site.id}`, { method: 'PATCH', json: {} })).toMatchObject({
      name: 'Renamed',
    })

    expect(
      await server.adminJson(`/sites/${site.id}`, {
        method: 'DELETE',
        json: { confirm: 'example.com', password: PASSWORD },
      }),
    ).toEqual({
      ok: true,
    })
    expect((await server.admin(`/sites/${site.id}`)).status).toBe(404)
  })

  it('validates input', async () => {
    const { site } = await server.createSite()
    const invalid = [
      { domain: 'not a domain' },
      { name: '' },
      { timezone: 'Mars/Olympus' },
      { currency: 'euro' },
      { privacyMode: 'loose' },
      { retentionDays: 0 },
      { retentionDays: 1.5 },
      { allowLocalhost: 'yes' },
      { ignoredIps: ['not-an-ip!'] },
      { ignoredIps: 'x' },
      { webhookSecrets: [] },
      { webhookSecrets: { paypal: 'x' } },
      { webhookSecrets: { stripe: 42 } },
    ]
    for (const json of invalid) {
      const response = await server.admin(`/sites/${site.id}`, { method: 'PATCH', json })
      expect(response.status, JSON.stringify(json)).toBe(400)
    }
    expect((await server.admin('/sites', { method: 'POST', json: { name: 'No domain' } })).status).toBe(400)
    expect((await server.admin('/sites', { method: 'POST', body: '[]' })).status).toBe(400)
  })

  it('rotates the API key so the old one stops working', async () => {
    const { site, apiKey } = await server.createSite()
    const pay = (key: string) =>
      server.request('/v1/payments', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}` },
        body: JSON.stringify({ id: `p-${key}`, amount: 100, currency: 'USD' }),
      })
    expect((await pay(apiKey)).status).toBe(200)
    const { apiKey: next } = await server.adminJson<{ apiKey: string }>(`/sites/${site.id}/rotate-key`, {
      method: 'POST',
    })
    expect(next).not.toBe(apiKey)
    expect((await pay(apiKey)).status).toBe(401)
    expect((await pay(next)).status).toBe(200)
  })

  it('deletes all data of a deleted site', async () => {
    const { site } = await server.createSite()
    await server.event({ w: site.id, t: 'pageview', u: 'https://example.com/' })
    await server.admin(`/sites/${site.id}`, { method: 'DELETE', json: { confirm: 'example.com', password: PASSWORD } })
    for (const table of ['sites', 'sessions', 'events', 'visitors']) {
      expect(await server.rows(`SELECT * FROM ${table}`)).toEqual([])
    }
  })

  it('requires login for every site route', async () => {
    const { site } = await server.createSite()
    for (const path of ['/sites', `/sites/${site.id}`, `/sites/${site.id}/overview`, `/sites/unknown/overview`]) {
      expect((await server.request(path)).status).toBe(401)
    }
  })
})

describe('share links', () => {
  it('give read-only access to stats with the token and nothing else', async () => {
    const { site } = await server.createSite()
    const shared = await server.adminJson<Site>(`/sites/${site.id}`, { method: 'PATCH', json: { shareToken: true } })
    const token = shared.shareToken ?? ''
    expect(token).toMatch(/^[0-9a-z]{24}$/)

    expect((await server.request(`/sites/${site.id}/overview?share=${token}`)).status).toBe(200)
    expect(
      (await server.request(`/sites/${site.id}/realtime`, { headers: { 'x-analytik-share': token } })).status,
    ).toBe(200)
    expect((await server.request(`/sites/${site.id}/overview?share=wrong-token-123456789012`)).status).toBe(401)
    expect((await server.request(`/sites/${site.id}/export?share=${token}`)).status).toBe(401)
    expect((await server.request(`/sites/${site.id}?share=${token}`)).status).toBe(401)
    expect(
      (await server.request(`/sites/${site.id}/funnels?share=${token}`, { method: 'POST', body: '{}' })).status,
    ).toBe(401)

    await server.admin(`/sites/${site.id}`, { method: 'PATCH', json: { shareToken: null } })
    expect((await server.request(`/sites/${site.id}/overview?share=${token}`)).status).toBe(401)
  })

  it('can be created together with the site', async () => {
    const { site } = await server.createSite({ shareToken: true })
    expect(site.shareToken).toMatch(/^[0-9a-z]{24}$/)
  })
})

describe('deleting and pausing a site', () => {
  it('asks for the domain and the admin password before deleting', async () => {
    const { site } = await server.createSite()
    const remove = (json?: unknown) => server.admin(`/sites/${site.id}`, { method: 'DELETE', json })
    expect((await remove()).status).toBe(400)
    expect((await remove({ password: PASSWORD })).status).toBe(400)
    expect((await remove({ confirm: 'example.com' })).status).toBe(403)
    const wrong = await remove({ confirm: 'example.com', password: 'nope' })
    expect(wrong.status).toBe(403)
    expect(await wrong.json()).toEqual({ error: 'wrong password' })
    expect((await server.admin(`/sites/${site.id}`)).status).toBe(200)
    for (let i = 0; i < 8; i++) await remove({ confirm: 'example.com', password: 'nope' })
    expect((await remove({ confirm: 'example.com', password: PASSWORD })).status).toBe(429)
  })

  it('asks for the domain with custom auth', async () => {
    const custom = await testServer('memory', { admin: { verify: () => true } })
    const { site } = await custom.createSite()
    const remove = (json: unknown) => custom.admin(`/sites/${site.id}`, { method: 'DELETE', json })
    const refused = await remove({ confirm: 'other.com' })
    expect(refused.status).toBe(400)
    expect(await refused.json()).toEqual({ error: "type the site's domain (example.com) to confirm" })
    expect((await remove({ confirm: 'example.com' })).status).toBe(200)
    await custom.close()
  })

  it('drops tracker events and server goals while paused, and records payments', async () => {
    const { site, apiKey } = await server.createSite()
    expect((await server.event({ w: site.id, t: 'pageview', u: 'https://example.com/' })).status).toBe(202)
    const paused = await server.adminJson<Site>(`/sites/${site.id}`, { method: 'PATCH', json: { paused: true } })
    expect(paused.paused).toBe(true)
    expect((await server.admin(`/sites/${site.id}`, { method: 'PATCH', json: { paused: 'yes' } })).status).toBe(400)
    await server.event({ w: site.id, t: 'pageview', u: 'https://example.com/pricing' })
    expect(
      await server.analytik.ingest({
        payload: { w: site.id, t: 'pageview', u: 'https://example.com/a' },
        userAgent: CHROME,
      }),
    ).toEqual({
      status: 202,
      visitorId: null,
      sessionId: null,
      filtered: 'paused',
    })
    const goal = await server.request('/v1/goals', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ name: 'signup', email: 'a@b.co' }),
    })
    expect(goal.status).toBe(202)
    expect(await goal.json()).toEqual({ ok: true, filtered: 'paused' })
    expect(await server.rows('SELECT path FROM events')).toEqual([{ path: '/' }])
    const pay = await server.request('/v1/payments', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ id: 'pi_1', amount: 900, currency: 'USD' }),
    })
    expect(pay.status).toBe(200)

    await server.admin(`/sites/${site.id}`, { method: 'PATCH', json: { paused: false } })
    await server.event({ w: site.id, t: 'pageview', u: 'https://example.com/docs' })
    expect(await server.rows('SELECT path FROM events ORDER BY ts')).toHaveLength(2)
  })
})

describe('dashboard preferences', () => {
  it.each(storageKinds())('stores them as one JSON document on %s', async (kind) => {
    const store = await testServer(kind)
    expect(await store.adminJson('/preferences')).toEqual({})
    const first = { live: true, layout: [{ id: 'summary', wide: true }] }
    expect(await store.adminJson('/preferences', { method: 'PUT', json: first })).toEqual(first)
    await store.adminJson('/preferences', { method: 'PUT', json: { live: false } })
    expect(await store.adminJson('/preferences')).toEqual({ live: false })
    await store.close()
  })

  it('is admin only and takes a JSON object', async () => {
    expect((await server.request('/preferences')).status).toBe(401)
    expect((await server.admin('/preferences', { method: 'PUT', json: [1, 2] })).status).toBe(400)
    await server.adminJson('/preferences', { method: 'PUT', json: {} })
    await server.rows("UPDATE preferences SET value = 'not json' RETURNING key")
    expect(await server.adminJson('/preferences')).toEqual({})
    await server.rows("UPDATE preferences SET value = '[1]' RETURNING key")
    expect(await server.adminJson('/preferences')).toEqual({})
  })
})
