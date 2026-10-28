import assets from 'virtual:analytik-standalone'

import icon from './icon.svg?raw'

export interface StandaloneOptions {
  /** Where the analytik API is mounted, as a path or a full URL. Defaults to `/api`. */
  api?: string
  /** The browser tab's title. */
  title?: string
}

type Fetch<A extends unknown[]> = (request: Request, ...args: A) => Response | Promise<Response>

const escapeAttribute = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

async function fingerprint(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest).slice(0, 6)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

const SECURITY = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'x-frame-options': 'DENY',
  // The dashboard styles some elements inline; site favicons come from the tracked sites themselves.
  'content-security-policy':
    "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
}

/**
 * Puts the dashboard and the tracker script in front of an analytik app, so one deployment serves everything:
 * `/` is the dashboard (sign in with the admin password), `/js/analytik.js` is the tracker, and every other request
 * goes to `app`. Returns an object with the same `fetch` as `app`, ready to export from a Worker or hand to a server.
 *
 * The dashboard is built into this module, so importing it adds about a megabyte to the bundle; leave it out of
 * deployments that only collect data and embed the dashboard elsewhere.
 */
export function withDashboard<A extends unknown[]>(
  app: { fetch: Fetch<A> },
  options: StandaloneOptions = {},
): { fetch: Fetch<A> } {
  const api = options.api ?? '/api'
  const title = options.title ?? 'Analytik - privacy-first analytics'
  const names = Promise.all([fingerprint(assets.js), fingerprint(assets.css)])

  const page = async (): Promise<Response> => {
    const [js, css] = await names
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="light dark">
<title>${escapeAttribute(title)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/_analytik/${css}.css">
<style>body{margin:0}#root>.analytik{min-height:100vh;min-height:100dvh;overflow-x:clip}</style>
</head>
<body>
<div id="root" data-api="${escapeAttribute(api)}"></div>
<script type="module" src="/_analytik/${js}.js"></script>
</body>
</html>`
    return new Response(html, {
      headers: { ...SECURITY, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' },
    })
  }

  const asset = (body: string, type: string, cache: string): Response =>
    new Response(body, { headers: { ...SECURITY, 'content-type': type, 'cache-control': cache } })

  return {
    async fetch(request, ...args) {
      if (request.method === 'GET' || request.method === 'HEAD') {
        const { pathname } = new URL(request.url)
        if (pathname === '/' || pathname === '/index.html') return page()
        if (pathname === '/favicon.svg') return asset(icon, 'image/svg+xml', 'public, max-age=86400')
        // The old path keeps working for snippets pasted before the tracker moved under /js.
        if (pathname === '/js/analytik.js' || pathname === '/analytik.js') {
          return asset(assets.tracker, 'text/javascript; charset=utf-8', 'public, max-age=86400')
        }
        const match = /^\/_analytik\/([0-9a-f]{12})\.(js|css)$/.exec(pathname)
        if (match) {
          const [js, css] = await names
          if (match[2] === 'js' && match[1] === js) {
            return asset(assets.js, 'text/javascript; charset=utf-8', 'public, max-age=31536000, immutable')
          }
          if (match[2] === 'css' && match[1] === css) {
            return asset(assets.css, 'text/css; charset=utf-8', 'public, max-age=31536000, immutable')
          }
        }
      }
      return app.fetch(request, ...args)
    },
  }
}
