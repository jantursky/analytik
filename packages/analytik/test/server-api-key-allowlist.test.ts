import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { EmailMessage } from '../src/server/email/types'
import { MINUTE } from '../src/shared/time'
import type { ApiKey, ApiKeyEvent } from '../src/shared/types'
import { PASSWORD, type TestServer, testServer } from './helpers/server'

let server: TestServer
beforeEach(async () => {
  server = await testServer()
})
afterEach(() => server.close())

interface Created {
  key: ApiKey
  secret: string
}

const LISTED = '203.0.113.7'
const OTHER = '198.51.100.9'

const made = async (json: Record<string, unknown> = {}): Promise<Created> => {
  const response = await server.admin('/api-keys', {
    method: 'POST',
    json: { label: 'Grafana', password: PASSWORD, ...json },
  })
  expect(response.status).toBe(201)
  return (await response.json()) as Created
}

const from = (secret: string, ip: string | null, path = '/v1/whoami') =>
  server.request(path, {
    headers: { authorization: `Bearer ${secret}`, ...(ip !== null && { 'cf-connecting-ip': ip }) },
  })

const edit = (id: string, json: Record<string, unknown>) =>
  server.admin(`/api-keys/${id}`, { method: 'PATCH', json: { password: PASSWORD, ...json } })

const events = async (type: string) =>
  (await server.adminJson<ApiKeyEvent[]>('/api-keys/events')).filter((e) => e.type === type)

describe('setting a list', () => {
  it('stores canonical entries from create and returns them', async () => {
    const { key } = await made({ ipAllowlist: ['203.0.113.9/24', '2001:DB8::/32', '203.0.113.0/24'] })
    expect(key.ipAllowlist).toEqual(['203.0.113.0/24', '2001:db8::/32'])
    const listed = await server.adminJson<ApiKey[]>('/api-keys')
    expect(listed[0]?.ipAllowlist).toEqual(['203.0.113.0/24', '2001:db8::/32'])
  })

  it('leaves a key without a list open to any address', async () => {
    const { key, secret } = await made()
    expect(key.ipAllowlist).toEqual([])
    expect((await from(secret, OTHER)).status).toBe(200)
    expect((await from(secret, null)).status).toBe(200)
  })

  it('refuses a bad entry or too many with 400 and saves nothing', async () => {
    const bad = await server.admin('/api-keys', {
      method: 'POST',
      json: { label: 'x', password: PASSWORD, ipAllowlist: ['10.0.0.1/33'] },
    })
    expect(bad.status).toBe(400)
    expect(((await bad.json()) as { error: string }).error).toContain('10.0.0.1/33')
    expect(await server.adminJson<ApiKey[]>('/api-keys')).toEqual([])

    const { key } = await made({ ipAllowlist: [LISTED] })
    const many = await edit(key.id, { ipAllowlist: Array.from({ length: 21 }, (_, i) => `10.0.0.${i}`) })
    expect(many.status).toBe(400)
    expect((await edit(key.id, { ipAllowlist: 'nope' })).status).toBe(400)
    expect((await edit(key.id, { ipAllowlist: [1] })).status).toBe(400)
    expect((await server.adminJson<ApiKey[]>('/api-keys'))[0]?.ipAllowlist).toEqual([LISTED])
  })
})

describe('enforcement', () => {
  it('lets a listed address through and refuses another with the same 403', async () => {
    const { secret } = await made({ ipAllowlist: ['203.0.113.0/24'] })
    expect((await from(secret, LISTED)).status).toBe(200)
    const refused = await from(secret, OTHER)
    expect(refused.status).toBe(403)
    expect(await refused.json()).toEqual({ error: 'this key cannot be used from this address' })
  })

  it('matches an IPv6 range', async () => {
    const { secret } = await made({ ipAllowlist: ['2001:db8::/32'] })
    expect((await from(secret, '2001:db8::5')).status).toBe(200)
    expect((await from(secret, '2001:db9::5')).status).toBe(403)
  })

  it('fails closed when the address is unknown, with the same answer', async () => {
    const { secret } = await made({ ipAllowlist: ['0.0.0.0/0'] })
    const refused = await from(secret, null)
    expect(refused.status).toBe(403)
    expect(await refused.json()).toEqual({ error: 'this key cannot be used from this address' })
    expect((await events('denied_ip'))[0]?.detail).toBe('unknown')
  })

  it('checks the address before scope and site, so a refused address learns nothing about them', async () => {
    const { secret } = await made({ ipAllowlist: [LISTED] })
    const refused = await from(secret, OTHER, '/v1/email')
    expect(await refused.json()).toEqual({ error: 'this key cannot be used from this address' })
    expect(((await (await from(secret, LISTED, '/v1/email')).json()) as { error: string }).error).toContain(
      'not available to API keys',
    )
  })

  it('still answers 401 for a bad key, whatever the address', async () => {
    expect((await from('anl_nope', OTHER)).status).toBe(401)
  })

  it('does not count a refused valid key toward the failed-lookup limit', async () => {
    const { secret } = await made({ ipAllowlist: [LISTED] })
    for (let i = 0; i < 40; i++) expect((await from(secret, OTHER)).status).toBe(403)
    // Had those counted as failed lookups, this address would now be answered 429 instead of 401.
    expect((await from('anl_nope', OTHER)).status).toBe(401)
  })

  it('never applies to the admin session', async () => {
    const { key } = await made({ ipAllowlist: ['192.0.2.1'] })
    expect((await server.admin('/whoami')).status).toBe(200)
    expect((await edit(key.id, { ipAllowlist: [] })).status).toBe(200)
  })
})

describe('editing', () => {
  it('needs the password, also to clear the list', async () => {
    const { key, secret } = await made({ ipAllowlist: [LISTED] })
    const wrong = await edit(key.id, { ipAllowlist: [OTHER], password: 'nope' })
    expect(wrong.status).toBe(403)
    const clear = await server.admin(`/api-keys/${key.id}`, { method: 'PATCH', json: { ipAllowlist: [] } })
    expect(clear.status).toBe(403)
    expect((await from(secret, OTHER)).status).toBe(403)
  })

  it('changes and clears the list at once', async () => {
    const { key, secret } = await made({ ipAllowlist: [LISTED] })
    expect((await from(secret, OTHER)).status).toBe(403)
    const changed = await edit(key.id, { ipAllowlist: [OTHER] })
    expect(changed.status).toBe(200)
    expect(((await changed.json()) as ApiKey).ipAllowlist).toEqual([OTHER])
    expect((await from(secret, OTHER)).status).toBe(200)
    expect((await from(secret, LISTED)).status).toBe(403)
    expect((await edit(key.id, { ipAllowlist: [] })).status).toBe(200)
    expect((await from(secret, LISTED)).status).toBe(200)
  })

  it('answers 404 for a key that does not exist', async () => {
    expect((await edit('ky_missing', { ipAllowlist: [LISTED] })).status).toBe(404)
  })

  it('is closed to keys, even a write key from a listed address', async () => {
    const { key, secret } = await made({ scope: 'write', ipAllowlist: [LISTED] })
    const response = await server.request(`/v1/api-keys/${key.id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${secret}`, 'cf-connecting-ip': LISTED },
      body: JSON.stringify({ ipAllowlist: [], password: PASSWORD }),
    })
    expect(response.status).toBe(403)
    expect((await server.adminJson<ApiKey[]>('/api-keys'))[0]?.ipAllowlist).toEqual([LISTED])
  })

  it('takes a custom admin without a password', async () => {
    await server.close()
    server = await testServer('memory', { admin: { verify: () => true } })
    const response = await server.request('/api-keys', { method: 'POST', body: JSON.stringify({ label: 'x' }) })
    const { key } = (await response.json()) as Created
    const changed = await server.request(`/api-keys/${key.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ipAllowlist: [LISTED] }),
    })
    expect(changed.status).toBe(200)
  })
})

describe('audit log', () => {
  it('writes one denied_ip entry per key and address a minute', async () => {
    const { secret } = await made({ ipAllowlist: [LISTED] })
    for (let i = 0; i < 50; i++) await from(secret, OTHER)
    expect(await events('denied_ip')).toHaveLength(1)
    await from(secret, '198.51.100.10')
    expect(await events('denied_ip')).toHaveLength(2)
    server.advance(MINUTE)
    await from(secret, OTHER)
    const entries = await events('denied_ip')
    expect(entries).toHaveLength(3)
    expect(entries.map((e) => e.detail).sort()).toEqual([OTHER, OTHER, '198.51.100.10'].sort())
    expect(JSON.stringify(entries)).not.toContain(secret)
  })

  it('records an edit with counts, never addresses or the secret', async () => {
    const { key, secret } = await made({ ipAllowlist: [LISTED] })
    await edit(key.id, { ipAllowlist: [LISTED, OTHER] })
    const [entry] = await events('allowlist_changed')
    expect(entry?.detail).toBe('1 to 2 addresses')
    expect(JSON.stringify(entry)).not.toContain(OTHER)
    expect(JSON.stringify(entry)).not.toContain(secret)
  })

  it('keeps at most 200 rows however many addresses are refused', async () => {
    const { secret } = await made({ ipAllowlist: [LISTED] })
    for (let i = 0; i < 230; i++) await from(secret, `198.51.${Math.floor(i / 250)}.${(i % 250) + 1}`)
    expect((await server.adminJson<ApiKeyEvent[]>('/api-keys/events')).length).toBeLessThanOrEqual(200)
  })
})

describe('e-mail', () => {
  it('goes out for an edit only, not for a refused address', async () => {
    await server.close()
    const inbox: EmailMessage[] = []
    server = await testServer('memory', {
      email: {
        from: 'analytik@example.com',
        to: 'me@example.com',
        send: (message) => {
          inbox.push(message)
          return Promise.resolve()
        },
      },
    })
    const { key, secret } = await made({ ipAllowlist: [LISTED] })
    inbox.length = 0
    await from(secret, OTHER)
    expect(inbox).toEqual([])
    await edit(key.id, { ipAllowlist: [OTHER] })
    expect(inbox.map((m) => m.subject)).toEqual(['API key allowlist changed: Grafana'])
    expect(inbox[0]?.text).toContain('Allowed addresses: 1')
    expect(JSON.stringify(inbox)).not.toContain(secret)
  })
})
