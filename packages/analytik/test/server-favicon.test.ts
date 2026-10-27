import { afterEach, describe, expect, it, vi } from 'vitest'

import { siteFavicon } from '../src/server/favicon'
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

  it('falls back to /favicon.ico, takes a site-relative or protocol-relative link, and skips what is not an icon', async () => {
    const asked = site({
      'https://a.example.com/favicon.ico': () => image('application/octet-stream'),
      'https://b.example.com/': () => page("<link rel='shortcut icon' href='//cdn.example.net/i.ico'>"),
      'https://cdn.example.net/i.ico': () => image('image/x-icon'),
      'https://c.example.com/': () =>
        page('<link rel="icon" href="/i.png"><link rel="icon" href="http://insecure.example.com/x.png">'),
      'https://c.example.com/i.png': () => new Response('<html>', { headers: { 'content-type': 'text/html' } }),
    })
    expect((await siteFavicon('a.example.com'))?.headers.get('content-type')).toBe('image/x-icon')
    expect((await siteFavicon('b.example.com'))?.headers.get('content-type')).toBe('image/x-icon')
    expect(await siteFavicon('c.example.com')).toBeNull()
    expect(asked).not.toContain('http://insecure.example.com/x.png')
  })

  it('refuses an icon that is too big or empty, and survives a failing request', async () => {
    site({
      'https://big.example.com/favicon.ico': () => image('image/x-icon', new Uint8Array(100_001)),
      'https://empty.example.com/favicon.ico': () => image('image/x-icon', new Uint8Array(0)),
    })
    expect(await siteFavicon('big.example.com')).toBeNull()
    expect(await siteFavicon('empty.example.com')).toBeNull()
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
    expect(await siteFavicon('down.example.com')).toBeNull()
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
    ]) {
      expect(await siteFavicon(domain)).toBeNull()
    }
    expect(asked).toEqual([])
  })
})
