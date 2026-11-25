import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'

import { playwright } from '@vitest/browser-playwright'
import { build, type Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

// The tracker runs as a classic script in real engines against a fake collector served by the test server:
//   GET  /__analytik/analytik.js           the tracker, bundled and minified as the IIFE that ships
//   GET  /__analytik/page/:run?attrs=...  a page with the script tag and a few elements to click
//   POST /__analytik/run/:run/api/*       records the body (event) or answers with ids (attribution)
//   GET  /__analytik/run/:run/received    what that page sent so far
const entry = fileURLToPath(new URL('./src/tracker/tracker.ts', import.meta.url))
const extrasEntry = fileURLToPath(new URL('./src/tracker/extras.ts', import.meta.url))

async function bundle(file: string): Promise<string> {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: { write: false, minify: true, lib: { entry: file, formats: ['iife'], name: 'analytik' } },
  })
  const outputs = Array.isArray(result) ? result : [result]
  for (const output of outputs) {
    if ('output' in output) {
      const chunk = output.output.find((o) => o.type === 'chunk')
      if (chunk && 'code' in chunk) return chunk.code
    }
  }
  throw new Error('bundle has no chunk')
}

const escapeAttr = (value: string): string => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** A path under `/dnt/` turns Do Not Track on, `/bot/` looks automated; a path ending in `/missing` is a marked not-found page. */
function page(run: string, attrs: Record<string, string>, path: string): string {
  const rendered = Object.entries({ 'data-api': `/__analytik/run/${run}/api`, ...attrs })
    .map(([name, value]) => `${name}="${escapeAttr(value)}"`)
    .join(' ')
  const notFound = path.endsWith('/missing') ? '<meta name="analytik-404">' : ''
  return `<!doctype html><html><head><meta charset="utf-8">${notFound}
<script>
  // Playwright sets navigator.webdriver, which the tracker treats as a bot.
  Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => location.pathname.includes('/bot/'), configurable: true })
  Object.defineProperty(Navigator.prototype, 'doNotTrack', { get: () => (location.pathname.includes('/dnt/') ? '1' : null), configurable: true })
  // Links marked data-stay record the click but do not navigate.
  document.addEventListener('click', (e) => { if (e.target.closest('[data-stay]')) e.preventDefault() })
</script>
<script defer src="/__analytik/analytik.js" ${rendered}></script>
<script defer src="/__analytik/analytik-extras.js"></script>
</head><body>
<a id="out" data-stay href="https://outbound.example.org/docs?q=1">Docs</a>
<a id="in" data-stay href="/internal">Internal</a>
<a id="pdf" data-stay href="/files/guide.pdf?token=abc">Guide</a>
<button id="signup" data-analytik-event="signup" data-analytik-plan="pro">Sign up</button>
<button id="trial" data-analytik-event="trial" data-analytik-seats="3">Trial</button>
</body></html>`
}

function collector(): Plugin {
  const received = new Map<string, unknown[]>()
  let tracker: Promise<string> | undefined
  let extras: Promise<string> | undefined

  const read = (req: IncomingMessage): Promise<string> =>
    new Promise((resolve, reject) => {
      let body = ''
      req.setEncoding('utf8')
      req.on('data', (chunk: string) => (body += chunk))
      req.on('end', () => resolve(body))
      req.on('error', reject)
    })

  const send = (res: ServerResponse, status: number, type: string, body: string): void => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' })
    res.end(body)
  }

  return {
    name: 'analytik-collector',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const parts = url.pathname.split('/')
        if (parts[1] !== '__analytik') {
          next()
          return
        }
        const run = parts[3] ?? ''

        if (url.pathname === '/__analytik/analytik.js') {
          tracker ??= bundle(entry)
          tracker.then((code) => send(res, 200, 'text/javascript', code), next)
        } else if (url.pathname === '/__analytik/analytik-extras.js') {
          extras ??= bundle(extrasEntry)
          extras.then((code) => send(res, 200, 'text/javascript', code), next)
        } else if (parts[2] === 'page') {
          const attrs = JSON.parse(url.searchParams.get('attrs') ?? '{}') as Record<string, string>
          send(res, 200, 'text/html', page(run, attrs, url.pathname.replace(`/__analytik/page/${run}`, '')))
        } else if (parts[2] === 'run' && parts[4] === 'received') {
          send(res, 200, 'application/json', JSON.stringify(received.get(run) ?? []))
        } else if (parts[2] === 'run' && req.method === 'POST') {
          read(req).then((body) => {
            const list = received.get(run) ?? []
            list.push({
              path: parts.slice(4).join('/'),
              type: req.headers['content-type'],
              body: JSON.parse(body) as unknown,
            })
            received.set(run, list)
            if (parts.at(-1) === 'attribution')
              send(res, 200, 'application/json', '{"visitorId":"v_srv","sessionId":"s_srv"}')
            else send(res, 202, 'text/plain', '')
          }, next)
        } else next()
      })
    },
  }
}

export default defineConfig({
  plugins: [collector()],
  test: {
    include: ['test/browser/**/*.test.ts'],
    testTimeout: 20000,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }, { browser: 'firefox' }, { browser: 'webkit' }],
    },
  },
})
