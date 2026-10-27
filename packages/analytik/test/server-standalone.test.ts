import { describe, expect, it } from 'vitest'

import { createAnalytik } from '../src/server'
import { withDashboard } from '../src/standalone'
import { memoryStorage } from '../src/storage/memory'

const app = () => createAnalytik({ storage: memoryStorage(), admin: { password: 'pw', secret: 'x'.repeat(40) } }).app
const get = (handler: { fetch: (request: Request) => Response | Promise<Response> }, path: string, method = 'GET') =>
  handler.fetch(new Request(`https://analytics.example.com${path}`, { method }))

describe('the dashboard served in front of the app', () => {
  it('sends the page with the API path and links to fingerprinted files', async () => {
    const page = await get(withDashboard(app()), '/')
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(page.headers.get('x-frame-options')).toBe('DENY')
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    const html = await page.text()
    expect(html).toContain('<div id="root" data-api="/api"></div>')
    expect(html).toContain('<title>Analytik - privacy-first analytics</title>')
    expect(html).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">')
    expect(html).toMatch(/href="\/_analytik\/[0-9a-f]{12}\.css"/)
    expect(html).toMatch(/src="\/_analytik\/[0-9a-f]{12}\.js"/)
  })

  it('serves the script and the stylesheet from the paths the page names, cached for good', async () => {
    const handler = withDashboard(app())
    const html = await (await get(handler, '/')).text()
    const js = /src="(\/_analytik\/[0-9a-f]{12}\.js)"/.exec(html)?.[1] ?? ''
    const css = /href="(\/_analytik\/[0-9a-f]{12}\.css)"/.exec(html)?.[1] ?? ''
    const script = await get(handler, js)
    expect(await script.text()).toContain('dashboard')
    expect(script.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(script.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(await (await get(handler, css)).text()).toBe('body{margin:0}')
    // A path with another fingerprint is not the file; it falls through to the app, which has no such route.
    expect((await get(handler, '/_analytik/000000000000.js')).status).toBe(404)
  })

  it('serves the brand mark as the page icon', async () => {
    const icon = await get(withDashboard(app()), '/favicon.svg')
    expect(icon.headers.get('content-type')).toBe('image/svg+xml')
    expect(await icon.text()).toContain('<svg')
  })

  it('serves the tracker at /analytik.js and leaves everything else to the app', async () => {
    const handler = withDashboard(app())
    const tracker = await get(handler, '/analytik.js')
    expect(await tracker.text()).toBe('(function(){})()')
    expect(tracker.headers.get('cache-control')).toBe('public, max-age=86400')
    expect(await (await get(handler, '/api/health')).json()).toEqual({ ok: true, dialect: 'memory' })
    // Only reads are answered here; a POST to the same paths belongs to the app.
    expect((await get(handler, '/', 'POST')).status).toBe(404)
    expect((await get(handler, '/index.html')).status).toBe(200)
  })

  it('takes the API location and the title from the options, escaped', async () => {
    const html = await (await get(withDashboard(app(), { api: '/s/api"><x', title: 'A <b> site' }), '/')).text()
    expect(html).toContain('data-api="/s/api&quot;>&lt;x"')
    expect(html).toContain('<title>A &lt;b> site</title>')
  })
})
