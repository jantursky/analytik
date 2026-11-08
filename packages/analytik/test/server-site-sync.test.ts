import { afterEach, describe, expect, it, vi } from 'vitest'

import { publicHost, readSite } from '../src/server/site-sync'
import { storageKinds } from './helpers/databases'
import { type TestServer, testServer } from './helpers/server'

let server: TestServer | undefined

afterEach(async () => {
  vi.unstubAllGlobals()
  await server?.close()
  server = undefined
})

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const page = (html: string) => new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
const image = (type = 'image/png', body: BodyInit = PNG) => new Response(body, { headers: { 'content-type': type } })

/** Answers the site's pages from `routes`, keyed by URL; anything else is a 404. */
function site(routes: Record<string, () => Response>) {
  const asked: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      asked.push(url)
      const route = routes[url]
      const response = route ? route() : new Response('nope', { status: 404 })
      // A real response carries the address it came from; the constructor leaves it empty.
      Object.defineProperty(response, 'url', { value: url })
      return Promise.resolve(response)
    }),
  )
  return asked
}

const read = (domain: string) => readSite(domain, { host: 'analytics.example.com', siteId: 'site_x' })

describe('site favicons', () => {
  it('finds the icon the home page names, over a favicon.ico that does not exist', async () => {
    server = await testServer()
    const { site: created } = await server.createSite({ domain: 'shop.example.com' })
    site({
      'https://shop.example.com/': () =>
        page(
          '<head><link rel="apple-touch-icon" href="/big.png"><link rel="icon" type="image/png" href="/img/icon.png"></head>',
        ),
      'https://shop.example.com/img/icon.png': () => image(),
      'https://shop.example.com/big.png': () => image('image/png', new Uint8Array(4)),
    })
    const response = await server.admin(`/sites/${created.id}/favicon`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('cache-control')).toBe('private, max-age=86400')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG)
  })

  it('is for admins only, and 404 when the site has no icon', async () => {
    server = await testServer()
    const { site: created } = await server.createSite({ domain: 'shop.example.com' })
    site({ 'https://shop.example.com/': () => page('<p>no icon</p>') })
    expect((await server.request(`/sites/${created.id}/favicon`)).status).toBe(401)
    expect((await server.admin(`/sites/${created.id}/favicon`)).status).toBe(404)
  })

  it('is served to a share link, so an app that only holds the link can show the icon', async () => {
    server = await testServer()
    const { site: created } = await server.createSite({ domain: 'shop.example.com', shareToken: true })
    site({
      'https://shop.example.com/': () => page('<link rel="icon" href="/i.png">'),
      'https://shop.example.com/i.png': () => image(),
    })
    const shared = await server.request(`/sites/${created.id}/favicon`, {
      headers: { 'x-analytik-share': created.shareToken ?? '' },
    })
    expect(shared.status).toBe(200)
    expect(new Uint8Array(await shared.arrayBuffer())).toEqual(PNG)
    expect(
      (await server.request(`/sites/${created.id}/favicon`, { headers: { 'x-analytik-share': 'wrong' } })).status,
    ).toBe(401)
  })

  it('falls back to /favicon.ico, takes a site-relative or protocol-relative link, and skips what is not an icon', async () => {
    const asked = site({
      'https://a.example.com/favicon.ico': () => image('application/octet-stream'),
      'https://b.example.com/': () => page("<link rel='shortcut icon' href='//cdn.example.net/i.ico'>"),
      'https://cdn.example.net/i.ico': () => image('image/x-icon'),
      'https://c.example.com/': () =>
        page('<link rel="icon" href="/i.png"><link rel="icon" href="http://insecure.example.com/x.png">'),
      'https://c.example.com/i.png': () => new Response('<html>', { headers: { 'content-type': 'text/html' } }),
    })
    expect((await read('a.example.com')).icon?.type).toBe('image/x-icon')
    expect((await read('b.example.com')).icon?.type).toBe('image/x-icon')
    expect((await read('c.example.com')).icon).toBeNull()
    expect(asked).not.toContain('http://insecure.example.com/x.png')
  })

  it('refuses an icon that is too big or empty, and survives a failing request', async () => {
    site({
      'https://big.example.com/favicon.ico': () => image('image/x-icon', new Uint8Array(100_001)),
      'https://empty.example.com/favicon.ico': () => image('image/x-icon', new Uint8Array(0)),
    })
    expect((await read('big.example.com')).icon).toBeNull()
    expect((await read('empty.example.com')).icon).toBeNull()
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
    expect(await read('down.example.com')).toMatchObject({ reachable: false, icon: null, tracker: 'unknown' })
  })

  it('only asks public host names', async () => {
    const asked = site({})
    for (const domain of [
      'localhost',
      '10.0.0.5',
      '192.168.1.2',
      'nas.local',
      'printer.internal',
      'single',
      'bad_name.example.com',
      '0x7f.1',
      '127.1',
      'test.test.analytik.dev',
    ]) {
      expect((await read(domain)).reachable).toBe(false)
    }
    expect(asked).toEqual([])
  })
})

describe('what a sync reads from the page', () => {
  const PAGE = (head: string, body = '') => page(`<!doctype html><html><head>${head}</head><body>${body}</body></html>`)

  it('takes the name from og:site_name over the title, decodes entities and trims', async () => {
    site({
      'https://a.example.com/': () =>
        PAGE('<title>Home | A</title><meta property="og:site_name" content="  Shop &amp; Co&#39;s  ">'),
      'https://b.example.com/': () => PAGE('<title>\n  Just   a\ttitle </title>'),
      'https://c.example.com/': () => PAGE(''),
    })
    expect((await read('a.example.com')).name).toBe("Shop & Co's")
    expect((await read('b.example.com')).name).toBe('Just a title')
    expect((await read('c.example.com')).name).toBeNull()
  })

  it('takes a hex theme-color, expanded to six digits, and ignores other values', async () => {
    site({
      'https://a.example.com/': () => PAGE('<meta name="theme-color" content="#FA0">'),
      'https://b.example.com/': () =>
        PAGE(
          '<meta name="theme-color" content="red"><meta name="theme-color" content="#336699" media="(prefers-color-scheme: dark)">',
        ),
      'https://c.example.com/': () => PAGE('<meta name="theme-color" content="rgb(1,2,3)">'),
    })
    expect((await read('a.example.com')).color).toBe('#ffaa00')
    expect((await read('b.example.com')).color).toBe('#336699')
    expect((await read('c.example.com')).color).toBeNull()
  })

  it('tries the icon links, then the manifest (the size nearest 64), then /favicon.ico', async () => {
    const asked = site({
      'https://a.example.com/': () => PAGE('<link rel="manifest" href="/site.webmanifest">'),
      'https://a.example.com/site.webmanifest': () =>
        new Response(
          JSON.stringify({
            icons: [
              { src: '/big.png', sizes: '512x512' },
              { src: '/mid.png', sizes: '64x64' },
            ],
          }),
          { headers: { 'content-type': 'application/manifest+json' } },
        ),
      'https://a.example.com/mid.png': () => image(),
      'https://a.example.com/big.png': () => image('image/png', new Uint8Array(3)),
    })
    const found = (await read('a.example.com')).icon
    expect(found?.bytes).toEqual(PNG)
    expect(asked).not.toContain('https://a.example.com/favicon.ico')
  })

  it('says whether the page loads this server’s tracker, by host or by the site id', async () => {
    const script = (src: string, extra = '') => `<script defer src="${src}" ${extra}></script>`
    site({
      'https://a.example.com/': () => PAGE(script('https://analytics.example.com/js/analytik.js', 'data-site="x"')),
      'https://b.example.com/': () => PAGE(script('https://other.example.net/js/analytik.js', 'data-site="site_x"')),
      'https://c.example.com/': () => PAGE(script('https://other.example.net/js/analytik.js', 'data-site="nope"')),
      'https://d.example.com/': () => PAGE('<p>nothing</p>'),
    })
    expect((await read('a.example.com')).tracker).toBe('found')
    expect((await read('b.example.com')).tracker).toBe('found')
    expect((await read('c.example.com')).tracker).toBe('not-found')
    expect((await read('d.example.com')).tracker).toBe('not-found')
    expect((await read('missing.example.com')).tracker).toBe('unknown')
  })

  it('follows redirects, but refuses one that leaves the public hosts or https', async () => {
    const redirect = (to: string) => () => new Response(null, { status: 301, headers: { location: to } })
    const asked = site({
      'https://a.example.com/': redirect('https://www.a.example.com/'),
      'https://www.a.example.com/': () => PAGE('<title>Moved</title>'),
      'https://b.example.com/': redirect('https://169.254.169.254/latest/meta-data'),
      'https://c.example.com/': redirect('http://c.example.com/'),
      'https://d.example.com/': redirect('https://localhost/'),
      'https://e.example.com/': redirect('https://e.example.com/'),
    })
    expect((await read('a.example.com')).name).toBe('Moved')
    for (const domain of ['b', 'c', 'd', 'e']) expect((await read(`${domain}.example.com`)).reachable).toBe(false)
    expect(asked).not.toContain('https://169.254.169.254/latest/meta-data')
    expect(asked).not.toContain('http://c.example.com/')
    expect(asked).not.toContain('https://localhost/')
  })

  it('does not read more of a page than it needs', async () => {
    site({ 'https://a.example.com/': () => PAGE('<title>Big</title>', 'x'.repeat(1_000_000)) })
    expect((await read('a.example.com')).name).toBe('Big')
  })

  it('knows a public host name from an address or an inside name', () => {
    expect(publicHost('shop.example.co.uk')).toBe(true)
    expect(publicHost('xn--bcher-kva.example')).toBe(true)
    for (const host of ['localhost', '1.2.3.4', '[::1]', 'a.arpa', 'x.local', 'nodots']) {
      expect(publicHost(host)).toBe(false)
    }
  })
})

describe('syncing a site with its website', () => {
  const PAGE = (head: string) => page(`<html><head>${head}</head></html>`)
  const home = {
    'https://shop.example.com/': () =>
      PAGE('<title>Real Shop</title><meta name="theme-color" content="#112233"><link rel="icon" href="/i.png">'),
    'https://shop.example.com/i.png': () => image(),
  }

  it('previews without changing anything, and tells a hand-typed name from the page’s', async () => {
    server = await testServer()
    const { site: created } = await server.createSite({ domain: 'shop.example.com', name: 'My shop' })
    site(home)
    const preview = await server.adminJson<{
      reachable: boolean
      tracker: string
      changes: { field: string; current: string | null; found: string | null; changed: boolean; manual?: boolean }[]
    }>(`/sites/${created.id}/sync`, { method: 'POST' })
    expect(preview.reachable).toBe(true)
    expect(preview.tracker).toBe('not-found')
    expect(preview.changes.map((c) => [c.field, c.current, c.changed])).toEqual([
      ['name', 'My shop', true],
      ['color', null, true],
      ['icon', null, true],
    ])
    expect(preview.changes[0]).toMatchObject({ found: 'Real Shop', manual: true })
    expect(preview.changes[2]?.found).toMatch(/^data:image\/png;base64,/)
    const after = await server.adminJson<{ name: string; color: string | null; iconHash: string | null }>(
      `/sites/${created.id}`,
    )
    expect(after).toMatchObject({ name: 'My shop', color: null, iconHash: null })
    expect(await server.rows('SELECT * FROM site_icons')).toEqual([])
  })

  it('applies only the fields asked for, and leaves a typed name alone unless it is asked for', async () => {
    server = await testServer()
    const { site: created } = await server.createSite({ domain: 'shop.example.com', name: 'My shop' })
    site(home)
    const first = await server.adminJson<{
      site: { name: string; color: string | null; iconHash: string | null }
      applied: string[]
    }>(`/sites/${created.id}/sync/apply`, { method: 'POST', json: { fields: ['icon', 'color'] } })
    expect(first.applied).toEqual(['color', 'icon'])
    expect(first.site).toMatchObject({ name: 'My shop', color: '#112233' })
    expect(first.site.iconHash).toMatch(/^[0-9a-f]{16}$/)

    const second = await server.adminJson<{ site: { name: string; nameSynced: boolean } }>(
      `/sites/${created.id}/sync/apply`,
      { method: 'POST', json: { fields: ['name'] } },
    )
    expect(second.site).toMatchObject({ name: 'Real Shop', nameSynced: true })
    // Typing a name again takes it back from the page.
    const typed = await server.adminJson<{ nameSynced: boolean }>(`/sites/${created.id}`, {
      method: 'PATCH',
      json: { name: 'Mine' },
    })
    expect(typed.nameSynced).toBe(false)
    // The preview no longer calls an unchanged icon changed.
    const preview = await server.adminJson<{ changes: { field: string; changed: boolean }[] }>(
      `/sites/${created.id}/sync`,
      { method: 'POST' },
    )
    expect(preview.changes.find((c) => c.field === 'icon')?.changed).toBe(false)
  })

  it('refuses bad field lists, an unreachable site and generated test sites, and is not open to share links', async () => {
    server = await testServer()
    const { site: created } = await server.createSite({ domain: 'shop.example.com', shareToken: true })
    const asked = site({})
    const apply = (json: unknown) => server!.admin(`/sites/${created.id}/sync/apply`, { method: 'POST', json })
    expect((await apply({})).status).toBe(400)
    expect((await apply({ fields: [] })).status).toBe(400)
    expect((await apply({ fields: ['domain'] })).status).toBe(400)
    expect((await apply({ fields: ['name'] })).status).toBe(502)

    const test = await server.createSite({ domain: 'busy.test.analytik.dev' })
    asked.length = 0
    expect(await server.adminJson(`/sites/${test.site.id}/sync`, { method: 'POST' })).toMatchObject({
      skipped: 'test-site',
      changes: [],
    })
    expect(
      (await server.admin(`/sites/${test.site.id}/sync/apply`, { method: 'POST', json: { fields: ['icon'] } })).status,
    ).toBe(400)
    expect((await server.admin(`/sites/${test.site.id}/favicon`)).status).toBe(404)
    expect(asked).toEqual([])

    const headers = { 'x-analytik-share': created.shareToken ?? '' }
    expect((await server.request(`/sites/${created.id}/sync`, { method: 'POST', headers })).status).toBe(401)
    expect(
      (
        await server.request(`/sites/${created.id}/sync/apply`, {
          method: 'POST',
          headers,
          body: '{"fields":["icon"]}',
        })
      ).status,
    ).toBe(401)
  })

  it('serves the stored icon while the site is down, and asks an unreadable site at most once an hour', async () => {
    server = await testServer()
    const { site: created } = await server.createSite({ domain: 'shop.example.com' })
    const asked = site({})
    expect((await server.admin(`/sites/${created.id}/favicon`)).status).toBe(404)
    expect((await server.admin(`/sites/${created.id}/favicon`)).status).toBe(404)
    const firstRound = asked.length
    expect(firstRound).toBeGreaterThan(0)
    server.advance(61 * 60_000)
    await server.admin(`/sites/${created.id}/favicon`)
    expect(asked.length).toBe(firstRound * 2)

    site(home)
    await server.adminJson(`/sites/${created.id}/sync/apply`, { method: 'POST', json: { fields: ['icon'] } })
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
    const response = await server.admin(`/sites/${created.id}/favicon`)
    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toMatch(/^"[0-9a-f]{16}"$/)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG)
  })

  it('serves a stale icon at once and fetches a new one behind it', async () => {
    server = await testServer()
    const { site: created } = await server.createSite({ domain: 'shop.example.com' })
    site(home)
    await server.adminJson(`/sites/${created.id}/sync/apply`, { method: 'POST', json: { fields: ['icon'] } })
    const before = await server.rows<{ hash: string }>('SELECT hash FROM site_icons')
    const newer = new Uint8Array([1, 2, 3, 4, 5])
    site({ ...home, 'https://shop.example.com/i.png': () => image('image/png', newer) })
    // Aging the row rather than the clock: an admin session would not last that long.
    await server.storage.run('UPDATE site_icons SET fetched_at = fetched_at - ?', [31 * 86_400_000])
    const response = await server.admin(`/sites/${created.id}/favicon`)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG)
    await vi.waitFor(async () => {
      const after = await server!.rows<{ hash: string }>('SELECT hash FROM site_icons')
      expect(after[0]?.hash).not.toBe(before[0]?.hash)
    })
    expect((await server.rows<{ icon_hash: string }>('SELECT icon_hash FROM sites'))[0]?.icon_hash).not.toBe(
      before[0]?.hash,
    )
  })

  it('removes the icon with the site', async () => {
    server = await testServer()
    const { site: created } = await server.createSite({ domain: 'shop.example.com' })
    site(home)
    await server.adminJson(`/sites/${created.id}/sync/apply`, { method: 'POST', json: { fields: ['icon'] } })
    expect(await server.rows('SELECT site_id FROM site_icons')).toHaveLength(1)
    await server.admin(`/sites/${created.id}`, {
      method: 'DELETE',
      json: { confirm: 'shop.example.com', password: 'correct horse battery staple' },
    })
    expect(await server.rows('SELECT site_id FROM site_icons')).toEqual([])
  })
})

describe.each(storageKinds())('a synced site on %s', (kind) => {
  it('stores the icon, colour and name, and serves the icon back', async () => {
    server = await testServer(kind)
    const { site: created } = await server.createSite({ domain: 'shop.example.com' })
    site({
      'https://shop.example.com/': () =>
        page('<title>Real Shop</title><meta name="theme-color" content="#112233"><link rel="icon" href="/i.png">'),
      'https://shop.example.com/i.png': () => image(),
    })
    await server.adminJson(`/sites/${created.id}/sync/apply`, {
      method: 'POST',
      json: { fields: ['name', 'color', 'icon'] },
    })
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
    const shown = await server.adminJson<{ name: string; color: string; nameSynced: boolean; iconHash: string }>(
      `/sites/${created.id}`,
    )
    expect(shown).toMatchObject({ name: 'Real Shop', color: '#112233', nameSynced: true })
    const response = await server.admin(`/sites/${created.id}/favicon`)
    expect(response.headers.get('etag')).toBe(`"${shown.iconHash}"`)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG)
  })
})
