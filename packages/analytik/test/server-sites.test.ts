import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Site } from '../src/shared/types'
import { type TestServer, testServer } from './helpers/server'

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

    expect(await server.adminJson(`/sites/${site.id}`, { method: 'DELETE' })).toEqual({ ok: true })
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
    await server.admin(`/sites/${site.id}`, { method: 'DELETE' })
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
