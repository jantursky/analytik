import type { PrivacyMode } from 'analytik'

import { escapeAttr, hostOf, scriptAttributes, scriptTag, siteOf, type SnippetOptions } from './snippet'

// Prompts for coding assistants: one to set up the Analytik server, one to add the tracker to a site.
// Each is a template filled with the chosen platform and the snippet options, so what gets copied is ready to paste.

export const SERVER_TARGETS = [
  { id: 'cloudflare-d1', label: 'Cloudflare Workers + D1' },
  { id: 'vercel-supabase', label: 'Vercel + Supabase' },
  { id: 'vercel-neon', label: 'Vercel + Neon' },
  { id: 'railway-postgres', label: 'Railway + Postgres' },
  { id: 'render-postgres', label: 'Render + Postgres' },
  { id: 'fly-sqlite', label: 'Fly.io + SQLite' },
  { id: 'netlify-supabase', label: 'Netlify Functions + Supabase' },
  { id: 'docker-bun-sqlite', label: 'Docker / VPS with Bun + SQLite' },
  { id: 'node-postgres', label: 'Node.js + Postgres' },
] as const

export const SITE_TARGETS = [
  { id: 'html', label: 'Plain HTML' },
  { id: 'react-vite', label: 'React (Vite)' },
  { id: 'nextjs', label: 'Next.js (App Router)' },
  { id: 'remix', label: 'Remix / React Router' },
  { id: 'vue', label: 'Vue' },
  { id: 'nuxt', label: 'Nuxt' },
  { id: 'astro', label: 'Astro' },
  { id: 'sveltekit', label: 'Svelte / SvelteKit' },
  { id: 'angular', label: 'Angular' },
  { id: 'solidstart', label: 'SolidStart' },
  { id: 'qwik', label: 'Qwik' },
  { id: 'gatsby', label: 'Gatsby' },
  { id: 'docusaurus', label: 'Docusaurus' },
  { id: 'hugo', label: 'Hugo' },
  { id: 'jekyll', label: 'Jekyll' },
  { id: 'eleventy', label: 'Eleventy' },
  { id: 'wordpress', label: 'WordPress' },
  { id: 'shopify', label: 'Shopify' },
  { id: 'webflow', label: 'Webflow' },
  { id: 'framer', label: 'Framer' },
  { id: 'ghost', label: 'Ghost' },
  { id: 'laravel', label: 'Laravel (Blade)' },
  { id: 'rails', label: 'Ruby on Rails' },
  { id: 'django', label: 'Django' },
  { id: 'flask', label: 'Flask' },
  { id: 'gtm', label: 'Google Tag Manager' },
] as const

export type ServerTarget = (typeof SERVER_TARGETS)[number]['id']
export type SiteTarget = (typeof SITE_TARGETS)[number]['id']

interface CodeFile {
  path: string
  lang: string
  code: string
}

const fence = ({ path, lang, code }: CodeFile): string => `\`${path}\`:\n\n\`\`\`${lang}\n${code.trimEnd()}\n\`\`\``

const numbered = (items: readonly string[]): string => items.map((item, index) => `${index + 1}. ${item}`).join('\n')

const bullets = (items: readonly string[]): string => items.map((item) => `- ${item}`).join('\n')

const labelOf = <T extends { id: string; label: string }>(targets: readonly T[], id: T['id']): string =>
  targets.find((target) => target.id === id)?.label ?? id

/* Server */

interface ServerGuide {
  stack: string
  install: string
  files: (mode: PrivacyMode, host: string) => CodeFile[]
  steps: string[]
  network: string
}

const ADMIN = 'admin: { password: process.env.ADMIN_PASSWORD!, secret: process.env.SESSION_SECRET! },'
const COPY_TRACKER = '`mkdir -p public && cp node_modules/analytik/dist/analytik.js public/analytik.js`'
const SECRETS =
  '`ADMIN_PASSWORD` (the dashboard password, not empty) and `SESSION_SECRET` (`openssl rand -hex 32`, at least 32 characters)'

const vercelFunction = (mode: PrivacyMode, comment: string, options: string): CodeFile => ({
  path: 'api/index.ts',
  lang: 'ts',
  code: `import postgres from 'postgres'
import { createAnalytik } from 'analytik/server'
import { postgresStorage } from 'analytik/storage/postgres'

// ${comment}
const sql = postgres(process.env.DATABASE_URL!, ${options})

const { app } = createAnalytik({
  storage: postgresStorage(sql),
  ${ADMIN}
  privacy: { mode: '${mode}' },
})

export default { fetch: app.fetch }`,
})

// A catch-all file name only catches one level of path on Vercel, so every /api/* path is rewritten to the function.
const VERCEL_JSON: CodeFile = {
  path: 'vercel.json',
  lang: 'json',
  code: `{
  "rewrites": [{ "source": "/api/(.*)", "destination": "/api" }]
}`,
}

const bunServer = (mode: PrivacyMode, storage: string, imports: string, network: string): CodeFile => ({
  path: 'server.ts',
  lang: 'ts',
  code: `${imports}
import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import { createAnalytik } from 'analytik/server'

const analytik = createAnalytik({
  storage: ${storage},
  ${ADMIN}
  privacy: { mode: '${mode}' },
  ${network}
})

const app = new Hono()
app.route('/', analytik.app)
// The Analytik app serves the API only; the tracker is a static file.
app.use('/analytik.js', serveStatic({ path: './public/analytik.js' }))

export default { port: Number(process.env.PORT ?? 3000), fetch: app.fetch }`,
})

const nodeServer = (mode: PrivacyMode, storage: string, imports: string): CodeFile => ({
  path: 'server.ts',
  lang: 'ts',
  code: `import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
${imports}
import { Hono } from 'hono'
import { createAnalytik } from 'analytik/server'

const analytik = createAnalytik({
  storage: ${storage},
  ${ADMIN}
  privacy: { mode: '${mode}' },
  trustProxy: 'forwarded',
})

const app = new Hono()
app.route('/', analytik.app)
// The Analytik app serves the API only; the tracker is a static file.
app.use('/analytik.js', serveStatic({ path: './public/analytik.js' }))

serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3000) })`,
})

const BUN_DOCKERFILE: CodeFile = {
  path: 'Dockerfile',
  lang: 'dockerfile',
  code: `FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY . .
RUN mkdir -p public && cp node_modules/analytik/dist/analytik.js public/analytik.js
ENV PORT=3000
EXPOSE 3000
CMD ["bun", "server.ts"]`,
}

const SERVER_GUIDES: Record<ServerTarget, ServerGuide> = {
  'cloudflare-d1': {
    stack: 'a Cloudflare Worker with a D1 database, serving the tracker as a static asset',
    install: 'npm install analytik hono && npm install -D wrangler @cloudflare/workers-types',
    files: (mode, host) => [
      {
        path: 'src/worker.ts',
        lang: 'ts',
        code: `import { createAnalytik, type Analytik } from 'analytik/server'
import { d1Storage } from 'analytik/storage/d1'

interface Env {
  DB: D1Database
  ADMIN_PASSWORD: string
  SESSION_SECRET: string
}

// Build the app once per isolate, not once per request.
let analytik: Analytik | undefined

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    analytik ??= createAnalytik({
      storage: d1Storage(env.DB),
      admin: { password: env.ADMIN_PASSWORD, secret: env.SESSION_SECRET },
      privacy: { mode: '${mode}' },
    })
    return analytik.app.fetch(request, env, ctx)
  },
}`,
      },
      {
        path: 'wrangler.jsonc',
        lang: 'jsonc',
        code: `{
  "name": "analytik",
  "main": "src/worker.ts",
  "compatibility_date": "2026-10-01",
  // Only API calls run the Worker; analytik.js is a free static asset.
  "assets": { "directory": "./public", "run_worker_first": ["/api/*"] },
  "d1_databases": [{ "binding": "DB", "database_name": "analytik", "database_id": "<from wrangler d1 create>" }],
  "routes": [{ "pattern": "${new URL(host).hostname}", "custom_domain": true }]
}`,
      },
    ],
    steps: [
      '`npx wrangler d1 create analytik` and put the printed `database_id` into `wrangler.jsonc`.',
      `${COPY_TRACKER} (repeat after every package upgrade).`,
      `\`npx wrangler secret put ADMIN_PASSWORD\` and \`npx wrangler secret put SESSION_SECRET\`: ${SECRETS}. For local runs put both in \`.dev.vars\`.`,
      '`npx wrangler deploy`. The schema is created on the first request (autoMigrate).',
    ],
    network: 'Client IP and location come from Cloudflare automatically (`cf-connecting-ip`, `request.cf`).',
  },
  'vercel-supabase': {
    stack: 'a Vercel function backed by Supabase Postgres, with the tracker in public/',
    install: 'npm install analytik hono postgres',
    files: (mode) => [
      vercelFunction(
        mode,
        "Supabase's transaction pooler (port 6543) has no prepared statements, so turn them off.",
        '{ prepare: false, max: 1 }',
      ),
      VERCEL_JSON,
    ],
    steps: [
      `${COPY_TRACKER}; Vercel serves \`public/\` as static files.`,
      "In Supabase, copy the transaction pooler connection string (port 6543) and set it as `DATABASE_URL` in the Vercel project's environment variables.",
      `Set ${SECRETS} in the Vercel environment variables.`,
      'Create the schema once with `npx analytik migrate --db "$DATABASE_URL"`, or let the first request do it (autoMigrate).',
      '`vercel deploy --prod`, then add the analytics hostname as a domain of the project.',
    ],
    network:
      'Client IP and location come from Vercel headers automatically (`x-vercel-forwarded-for`, `x-vercel-ip-*`).',
  },
  'vercel-neon': {
    stack: 'a Vercel function backed by Neon Postgres, with the tracker in public/',
    install: 'npm install analytik hono postgres',
    files: (mode) => [
      vercelFunction(
        mode,
        "Neon's pooled connection runs through PgBouncer, so prepared statements stay off.",
        "{ prepare: false, max: 1, ssl: 'require' }",
      ),
      VERCEL_JSON,
    ],
    steps: [
      `${COPY_TRACKER}; Vercel serves \`public/\` as static files.`,
      'Add Neon from the Vercel Marketplace (or create a Neon project) and use the pooled connection string (host ending in `-pooler`) as `DATABASE_URL`.',
      `Set ${SECRETS} in the Vercel environment variables.`,
      'Create the schema once with `npx analytik migrate --db "$DATABASE_URL"`, or let the first request do it (autoMigrate).',
      '`vercel deploy --prod`, then add the analytics hostname as a domain of the project.',
    ],
    network:
      'Client IP and location come from Vercel headers automatically (`x-vercel-forwarded-for`, `x-vercel-ip-*`).',
  },
  'railway-postgres': {
    stack: 'a Bun service on Railway with a Railway Postgres database',
    install: 'bun add analytik hono postgres',
    files: (mode) => [
      bunServer(
        mode,
        'postgresStorage(postgres(process.env.DATABASE_URL!))',
        "import postgres from 'postgres'\nimport { postgresStorage } from 'analytik/storage/postgres'",
        "// Railway's proxy passes the visitor's address in X-Forwarded-For.\n  trustProxy: 'forwarded',",
      ),
    ],
    steps: [
      `${COPY_TRACKER}, or run it in the build command so upgrades pick it up.`,
      'Add a PostgreSQL service and set `DATABASE_URL=${{Postgres.DATABASE_URL}}` on the app service.',
      `Set ${SECRETS} as service variables.`,
      'Start command `bun server.ts`. Railway sets `PORT`; bind to it.',
      'Generate a domain or attach the analytics hostname in the service settings.',
    ],
    network:
      'Location: Railway sends no geo headers, so countries stay empty unless you add a `geo(request)` option (for example behind Cloudflare, which adds `cf-ipcountry`).',
  },
  'render-postgres': {
    stack: 'a Node web service on Render with a Render Postgres database',
    install: 'npm install analytik hono @hono/node-server postgres',
    files: (mode) => [
      nodeServer(
        mode,
        'postgresStorage(postgres(process.env.DATABASE_URL!))',
        "import postgres from 'postgres'\nimport { postgresStorage } from 'analytik/storage/postgres'",
      ),
    ],
    steps: [
      'Create a Render Postgres database and set its internal connection string as `DATABASE_URL` on the web service.',
      `Set ${SECRETS} as environment variables.`,
      'Build command `npm ci && mkdir -p public && cp node_modules/analytik/dist/analytik.js public/analytik.js`.',
      'Start command `node server.ts` (Node 22.18+ runs TypeScript directly). Render sets `PORT`.',
      'Add the analytics hostname as a custom domain.',
    ],
    network:
      "Render's proxy sets X-Forwarded-For, hence `trustProxy: 'forwarded'`. Render sends no geo headers, so countries stay empty unless you add a `geo(request)` option.",
  },
  'fly-sqlite': {
    stack: 'a Bun app on Fly.io with SQLite on a Fly volume',
    install: 'bun add analytik hono',
    files: (mode) => [
      bunServer(
        mode,
        "sqliteStorage('/data/analytik.db')",
        "import { sqliteStorage } from 'analytik/storage/sqlite'",
        "// Fly's proxy puts the visitor's address in Fly-Client-IP.\n  clientIp: (request) => request.headers.get('fly-client-ip'),",
      ),
      BUN_DOCKERFILE,
      {
        path: 'fly.toml (excerpt)',
        lang: 'toml',
        code: `[http_service]
  internal_port = 3000
  force_https = true

[mounts]
  source = "analytik_data"
  destination = "/data"`,
      },
    ],
    steps: [
      '`fly launch --no-deploy`, then `fly volumes create analytik_data --size 1`.',
      `\`fly secrets set ADMIN_PASSWORD=... SESSION_SECRET=...\`: ${SECRETS}.`,
      '`fly deploy`, then `fly scale count 1`: SQLite lives on one volume, so run exactly one machine.',
      '`fly certs add <analytics hostname>` for a custom domain.',
    ],
    network: 'Fly sends no geo headers, so countries stay empty unless you add a `geo(request)` option.',
  },
  'netlify-supabase': {
    stack: 'a Netlify Function (v2, Web Request/Response) backed by Supabase Postgres',
    install: 'npm install analytik hono postgres && npm install -D @netlify/functions',
    files: (mode) => [
      {
        path: 'netlify/functions/analytik.ts',
        lang: 'ts',
        code: `import type { Config } from '@netlify/functions'
import postgres from 'postgres'
import { createAnalytik } from 'analytik/server'
import { postgresStorage } from 'analytik/storage/postgres'

// Supabase's transaction pooler (port 6543) has no prepared statements, so turn them off.
const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 })

const { app } = createAnalytik({
  storage: postgresStorage(sql),
  ${ADMIN}
  privacy: { mode: '${mode}' },
  // Netlify puts the visitor's address in this header.
  clientIp: (request) => request.headers.get('x-nf-client-connection-ip'),
})

export default (request: Request) => app.fetch(request)

export const config: Config = { path: '/api/*' }`,
      },
    ],
    steps: [
      `${COPY_TRACKER} and set the publish directory to \`public\`.`,
      'Set the Supabase transaction pooler connection string (port 6543) as `DATABASE_URL`.',
      `Set ${SECRETS} in the site's environment variables.`,
      'Create the schema once with `npx analytik migrate --db "$DATABASE_URL"`, or let the first request do it (autoMigrate).',
      '`netlify deploy --prod`, then add the analytics hostname as a domain.',
    ],
    network:
      'Netlify does not send the Cloudflare or Vercel geo headers, so countries stay empty unless you add a `geo(request)` option.',
  },
  'docker-bun-sqlite': {
    stack: 'a Docker container running Bun with a SQLite file on a volume, behind a reverse proxy on a VPS',
    install: 'bun add analytik hono',
    files: (mode, host) => [
      bunServer(
        mode,
        "sqliteStorage('/data/analytik.db')",
        "import { sqliteStorage } from 'analytik/storage/sqlite'",
        "// Caddy (below) appends the visitor's address to X-Forwarded-For.\n  trustProxy: 'forwarded',",
      ),
      BUN_DOCKERFILE,
      {
        path: 'Caddyfile',
        lang: 'caddyfile',
        code: `${new URL(host).hostname} {
  reverse_proxy localhost:3000
}`,
      },
    ],
    steps: [
      '`docker build -t analytik .`',
      `\`docker run -d --restart unless-stopped -p 127.0.0.1:3000:3000 -v analytik-data:/data -e ADMIN_PASSWORD=... -e SESSION_SECRET=... analytik\`: ${SECRETS}.`,
      'Run Caddy (or nginx with TLS) in front so the service is reachable over HTTPS on the analytics hostname.',
      'Back up the volume: `sqlite3 /data/analytik.db ".backup analytik-backup.db"` on a schedule.',
    ],
    network:
      'Without a CDN in front there are no geo headers, so countries stay empty unless you add a `geo(request)` option (put Cloudflare in front and read `cf-ipcountry`).',
  },
  'node-postgres': {
    stack: 'a Node.js server with Postgres, behind a reverse proxy',
    install: 'npm install analytik hono @hono/node-server pg',
    files: (mode) => [
      nodeServer(
        mode,
        'postgresStorage(new pg.Pool({ connectionString: process.env.DATABASE_URL }))',
        "import pg from 'pg'\nimport { postgresStorage } from 'analytik/storage/postgres'",
      ),
    ],
    steps: [
      `${COPY_TRACKER}.`,
      `Set \`DATABASE_URL\`, ${SECRETS} in the environment (systemd unit, PM2 ecosystem file or your platform).`,
      'Create the schema with `npx analytik migrate --db "$DATABASE_URL"`, or let the first request do it (autoMigrate).',
      'Run `node server.ts` (Node 22.18+ runs TypeScript directly) under a process manager.',
      "Put nginx or Caddy in front with TLS on the analytics hostname; it must set X-Forwarded-For, which `trustProxy: 'forwarded'` reads.",
    ],
    network:
      'Without a CDN in front there are no geo headers, so countries stay empty unless you add a `geo(request)` option.',
  },
}

const MODE_NOTES: Record<PrivacyMode, string> = {
  strict:
    'Strict (default): the tracker stores nothing on the device and the server never stores the IP. The visitor id is a salted hash that changes every month. It is designed so no cookie banner is needed (this is a design goal, not legal advice). `identify()` is ignored.',
  enriched:
    'Enriched: like strict, plus a per-tab id in sessionStorage once the visitor consents (`analytik.consent()`). Ask for consent first; `identify()` works only after consent.',
  persistent:
    'Persistent: first-party cookies `analytik_vid` (1 year) and `analytik_sid` (30 minutes), like most analytics tools. Treat it as needing consent in the EU and load the tracker only after consent.',
}

/** A prompt that asks a coding assistant to deploy the Analytik server on the chosen platform. */
export const serverPrompt = (target: ServerTarget, options: SnippetOptions): string => {
  const guide = SERVER_GUIDES[target]
  const host = hostOf(options)
  return `# Set up the Analytik server on ${labelOf(SERVER_TARGETS, target)}

## Goal

Deploy analytik (privacy-first, self-hosted web analytics, npm package \`analytik\`) as ${guide.stack}. It must answer at ${host}: the API under \`/api\` and the tracker script at \`/analytik.js\`. Work in a new, separate project, not inside the website that will be tracked.

## Install

\`\`\`sh
${guide.install}
\`\`\`

Analytik is ESM only and needs Node 22.19+ or Bun 1.3+ when it runs outside Workers. \`hono\` is a peer dependency.

## Code

${guide.files(options.mode, host).map(fence).join('\n\n')}

## Deploy

${numbered(guide.steps)}

${guide.network}

## Privacy mode

The default mode for new sites is \`${options.mode}\` (each site can override it). ${MODE_NOTES[options.mode]}

## Create the first site

\`\`\`sh
curl -c cookies.txt -X POST ${host}/api/auth/login -H 'Content-Type: application/json' -d '{"password":"<ADMIN_PASSWORD>"}'
curl -b cookies.txt -X POST ${host}/api/sites -H 'Content-Type: application/json' -d '{"name":"My site","domain":"example.com","currency":"EUR"}'
\`\`\`

Use the real domain of the tracked website (events from other hosts are rejected). The response contains \`site.id\` (the value for \`data-site\`) and \`apiKey\` (for server-side payments and goals, shown once).

## Verify

${numbered([
  `\`curl ${host}/api/health\` returns \`{"ok":true,...}\`.`,
  `\`curl -I ${host}/analytik.js\` returns 200 with a JavaScript content type.`,
  `\`npx analytik doctor --url ${host}\` reports no problems.`,
  `A test event is accepted with 202: \`curl -i -X POST ${host}/api/event -H 'Content-Type: text/plain' -H 'Origin: https://example.com' -d '{"w":"<site id>","t":"pageview","u":"https://example.com/"}'\` (use the site's domain).`,
])}

## Rules

${bullets([
  'Never commit secrets; read them from the platform environment.',
  'Do not add cookies, fingerprinting or third-party scripts on top of what Analytik does.',
  'Keep the API under `/api`; the tracker posts to `/api/event` on the origin of the script by default.',
  'Stop and tell me if a step needs an account, a paid plan or DNS access you do not have.',
])}
`
}

/* Site */

type Render = (options: SnippetOptions) => string

interface SiteGuide {
  where: string
  file: string
  lang: string
  code: Render
  notes?: string[]
}

const htmlTag: Render = (options) => scriptTag(options)

/** The tag as JSX: the same attributes plus framework-specific extras. */
const jsxTag = (options: SnippetOptions, extra: [string, string][] = []): string => {
  const parts = [...scriptAttributes(options), ...extra].map(([name, value]) =>
    value === '' ? name : `${name}="${escapeAttr(value)}"`,
  )
  return `<script ${parts.join(' ')}></script>`
}

/** The attributes as a JS object literal, for config files (Nuxt, Docusaurus). */
const objectTag = (options: SnippetOptions, indent: string): string => {
  const entries = scriptAttributes(options).map(([name, value]) => {
    const key = /^[a-z]+$/.test(name) ? name : `'${name}'`
    return `${indent}  ${key}: ${value === '' ? 'true' : `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`},`
  })
  return `{\n${entries.join('\n')}\n${indent}}`
}

/** The tag inside a template conditional, so it renders in production only. */
const inHead =
  (open: string, close: string): Render =>
  (options) =>
    `${open}\n${scriptTag(options)}\n${close}`

const SPA_NOTE = 'Client-side route changes are tracked automatically: the tracker listens to the History API.'

const SITE_GUIDES: Record<SiteTarget, SiteGuide> = {
  html: {
    where: 'Paste the tag into the `<head>` of every page, or once into the shared header include if the site has one.',
    file: 'index.html (every page)',
    lang: 'html',
    code: htmlTag,
  },
  'react-vite': {
    where:
      'Use the npm package so events are typed: wrap the app in `AnalytikProvider` in `src/main.tsx`. The client records the first pageview and every route change itself.',
    file: 'src/main.tsx',
    lang: 'tsx',
    code: (options) => `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AnalytikProvider } from 'analytik/react'

import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AnalytikProvider site="${escapeAttr(siteOf(options))}" api="${hostOf(options)}/api" mode="${options.mode}">
      <App />
    </AnalytikProvider>
  </StrictMode>,
)`,
    notes: [
      'Install with `npm install analytik` (React 19).',
      "Send events from components with `const analytik = useAnalytik()` from 'analytik/react', then `analytik.track(...)`.",
      'Do not also add the script tag, or pageviews count twice.',
    ],
  },
  nextjs: {
    where:
      'Add the tag with `next/script` in the root layout `app/layout.tsx`, inside `<body>`, with `strategy="afterInteractive"`. Use `next/script`\'s own loading instead of `defer`.',
    file: 'app/layout.tsx',
    lang: 'tsx',
    code: (options) => {
      const attributes = scriptAttributes(options)
        .filter(([name]) => name !== 'defer')
        .map(([name, value]) => `          ${name}="${escapeAttr(value)}"`)
      return `import Script from 'next/script'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Script
${attributes.join('\n')}
          strategy="afterInteractive"
        />
      </body>
    </html>
  )
}`
    },
    notes: [SPA_NOTE, 'Keep the existing layout content; only add the import and the `<Script>` element.'],
  },
  remix: {
    where: 'Add the tag to the `<head>` of the `Layout` export in `app/root.tsx`, after `<Links />`.',
    file: 'app/root.tsx',
    lang: 'tsx',
    code: (options) => `export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <Meta />
        <Links />
        ${jsxTag(options)}
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}`,
    notes: [SPA_NOTE],
  },
  vue: {
    where: 'Paste the tag into the `<head>` of `index.html` at the project root (Vite).',
    file: 'index.html',
    lang: 'html',
    code: htmlTag,
    notes: [`${SPA_NOTE} That covers Vue Router.`],
  },
  nuxt: {
    where: 'Register the script in `nuxt.config.ts` under `app.head.script` so it is in the head of every page.',
    file: 'nuxt.config.ts',
    lang: 'ts',
    code: (options) => `export default defineNuxtConfig({
  app: {
    head: {
      script: [
        ${objectTag(options, '        ')},
      ],
    },
  },
})`,
    notes: [SPA_NOTE, 'Merge into the existing config instead of replacing it.'],
  },
  astro: {
    where:
      'Add the tag to the `<head>` of the base layout (often `src/layouts/Layout.astro`) with `is:inline`, so Astro leaves it untouched instead of bundling it.',
    file: 'src/layouts/Layout.astro',
    lang: 'astro',
    code: (options) => jsxTag(options, [['is:inline', '']]),
    notes: ['View transitions (`<ClientRouter />`) navigate with the History API, which the tracker follows.'],
  },
  sveltekit: {
    where:
      'SvelteKit: paste the tag into `src/app.html`, inside `<head>` before `%sveltekit.head%`. Svelte with plain Vite: `index.html`.',
    file: 'src/app.html',
    lang: 'html',
    code: htmlTag,
    notes: [SPA_NOTE],
  },
  angular: {
    where: 'Paste the tag into the `<head>` of `src/index.html`.',
    file: 'src/index.html',
    lang: 'html',
    code: htmlTag,
    notes: [`${SPA_NOTE} That covers the Angular router.`],
  },
  solidstart: {
    where: 'Add the tag to the `<head>` of the document in `src/entry-server.tsx`.',
    file: 'src/entry-server.tsx',
    lang: 'tsx',
    code: (options) => `export default createHandler(() => (
  <StartServer
    document={({ assets, children, scripts }) => (
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          ${jsxTag(options)}
          {assets}
        </head>
        <body>
          <div id="app">{children}</div>
          {scripts}
        </body>
      </html>
    )}
  />
))`,
    notes: [SPA_NOTE],
  },
  qwik: {
    where: 'Add the tag to the `<head>` in `src/root.tsx` (Qwik City).',
    file: 'src/root.tsx',
    lang: 'tsx',
    code: (options) => `<head>
  <meta charset="utf-8" />
  <RouterHead />
  ${jsxTag(options)}
</head>`,
    notes: [SPA_NOTE],
  },
  gatsby: {
    where: 'Add the tag in `gatsby-ssr.js` (or `.tsx`) with `onRenderBody` and `setHeadComponents`.',
    file: 'gatsby-ssr.js',
    lang: 'jsx',
    code: (options) => `export const onRenderBody = ({ setHeadComponents }) => {
  setHeadComponents([
    ${jsxTag(options, [['key', 'analytik']])},
  ])
}`,
    notes: [SPA_NOTE],
  },
  docusaurus: {
    where: 'Register the script in `docusaurus.config.js` (or `.ts`) under the top-level `scripts` array.',
    file: 'docusaurus.config.js',
    lang: 'js',
    code: (options) => `export default {
  // ...the existing config
  scripts: [
    ${objectTag(options, '    ')},
  ],
}`,
    notes: [SPA_NOTE],
  },
  hugo: {
    where:
      "Add the tag to the site's head partial. If it comes from a theme, copy the theme's `layouts/partials/head.html` into the site's own `layouts/partials/` and edit the copy.",
    file: 'layouts/partials/head.html',
    lang: 'go-html-template',
    code: inHead('{{ if hugo.IsProduction }}', '{{ end }}'),
  },
  jekyll: {
    where:
      "Add the tag to `_includes/head.html`. With a gem theme (such as minima), copy the theme's `_includes/head.html` into the site first.",
    file: '_includes/head.html',
    lang: 'liquid',
    code: inHead('{% if jekyll.environment == "production" %}', '{% endif %}'),
    notes: ['Production builds run with `JEKYLL_ENV=production jekyll build`.'],
  },
  eleventy: {
    where:
      'Add the tag to the `<head>` of the base layout (often `_includes/base.njk` or `_includes/layouts/base.njk`).',
    file: '_includes/base.njk',
    lang: 'html',
    code: htmlTag,
  },
  wordpress: {
    where:
      'Without code: install the WPCode plugin and paste the tag into Code Snippets > Header & Footer > Header. With code: add a `wp_head` action to the child theme (never the parent theme, updates overwrite it).',
    file: 'wp-content/themes/<child-theme>/functions.php',
    lang: 'php',
    code: (options) => `add_action('wp_head', function () {
    ?>
    ${scriptTag(options)}
    <?php
});`,
    notes: ['Caching plugins may combine or delay scripts; exclude `analytik.js` from JavaScript optimisation.'],
  },
  shopify: {
    where: 'In Online Store > Themes > Edit code, open `layout/theme.liquid` and paste the tag just before `</head>`.',
    file: 'layout/theme.liquid',
    lang: 'liquid',
    code: htmlTag,
    notes: [
      'Checkout pages are not part of the theme. Record orders server side instead: an `orders/paid` webhook that calls `POST /api/v1/payments` with the site API key.',
    ],
  },
  webflow: {
    where:
      'In Site settings > Custom code, paste the tag into Head code, save and publish. Custom code needs a paid site plan.',
    file: 'Site settings > Custom code > Head code',
    lang: 'html',
    code: htmlTag,
  },
  framer: {
    where: 'In Site Settings > General > Custom Code, paste the tag into "End of <head> tag" and publish.',
    file: 'Site Settings > Custom Code > End of <head>',
    lang: 'html',
    code: htmlTag,
    notes: [SPA_NOTE],
  },
  ghost: {
    where: 'In Settings > Code injection, paste the tag into Site header and save.',
    file: 'Settings > Code injection > Site header',
    lang: 'html',
    code: htmlTag,
  },
  laravel: {
    where: 'Add the tag to the `<head>` of the main Blade layout, inside `@production` so local runs stay out.',
    file: 'resources/views/layouts/app.blade.php',
    lang: 'blade',
    code: inHead('@production', '@endproduction'),
  },
  rails: {
    where: 'Add the tag to the `<head>` of `app/views/layouts/application.html.erb`, for production only.',
    file: 'app/views/layouts/application.html.erb',
    lang: 'erb',
    code: inHead('<% if Rails.env.production? %>', '<% end %>'),
    notes: ['Turbo Drive navigations use the History API, which the tracker follows; keep the tag in `<head>`.'],
  },
  django: {
    where: 'Add the tag to the `<head>` of the base template that every page extends (often `templates/base.html`).',
    file: 'templates/base.html',
    lang: 'django',
    code: inHead('{% if not debug %}', '{% endif %}'),
    notes: ['`debug` is only set in templates when the request IP is in `INTERNAL_IPS`; otherwise the tag renders.'],
  },
  flask: {
    where: 'Add the tag to the `<head>` of the base Jinja template (often `templates/base.html`).',
    file: 'templates/base.html',
    lang: 'jinja',
    code: inHead('{% if not config.DEBUG %}', '{% endif %}'),
  },
  gtm: {
    where:
      'In Google Tag Manager, create a tag of type Custom HTML, paste the tag, set the trigger to All Pages (or Initialization - All Pages), then submit and publish the container.',
    file: 'GTM > Tags > New > Custom HTML',
    lang: 'html',
    code: htmlTag,
    notes: [
      'Leave "Support document.write" off. The tracker finds its tag by `data-site` when GTM injects it.',
      `${SPA_NOTE} Do not add a History Change trigger, or pageviews count twice.`,
    ],
  },
}

const PRIVACY_RULES: Record<PrivacyMode, string[]> = {
  strict: [
    'Strict mode stores nothing on the device: no cookie, no localStorage, no sessionStorage. The IP is used for a salted hash and never stored.',
    'By design no cookie banner is needed for Analytik in this mode, so do not put it behind a consent manager and do not list a cookie for it (not legal advice; the site owner decides).',
    'Do not call `analytik.identify()`: strict mode ignores it. Identify people only with their consent, on a site switched to enriched or persistent mode.',
  ],
  enriched: [
    'Enriched mode adds a per-tab id in sessionStorage, but only after `analytik.consent()`. Before that it behaves like strict mode.',
    "Call `analytik.consent()` from the site's consent banner when the visitor accepts analytics, and `analytik.withdrawConsent()` when they revoke it.",
    '`analytik.identify({ userId, email, name })` works only after consent. Never send it without consent.',
  ],
  persistent: [
    'Persistent mode sets first-party cookies (`analytik_vid`, 1 year; `analytik_sid`, 30 minutes). Treat it as needing consent in the EU.',
    "Load the tag only after the visitor accepts analytics in the site's consent banner, and call `analytik.withdrawConsent()` when they revoke it.",
    '`analytik.identify({ userId, email, name })` is allowed once the visitor consented.',
  ],
}

const eventsSection = (target: SiteTarget, host: string): string => {
  const call = target === 'react-vite' ? 'analytik' : 'window.analytik?'
  return `Pick the events that matter for this site (sign-ups, checkouts) and add them:

\`\`\`html
<!-- Declarative: a click on this element sends the goal "signup" with the prop plan=pro. -->
<button data-analytik-event="signup" data-analytik-plan="pro">Start free trial</button>
\`\`\`

\`\`\`js
${call}.track('signup', { plan: 'pro' })
// Revenue in major units; orderId de-duplicates repeats (for example a reloaded thank-you page).
${call}.revenue('purchase', 49, { currency: 'EUR', orderId: 'order_1042' })
\`\`\`

For payments confirmed on the server (Stripe, Dodo, Lemon Squeezy or your own backend), prefer \`POST ${host}/api/v1/payments\` with the site API key, so revenue is recorded even when the visitor closes the tab.${target === 'react-vite' ? '' : ' To call `analytik` before the script has loaded, add the queue stub first: `window.analytik = window.analytik || function () { (window.analytik.q = window.analytik.q || []).push(arguments) }`.'}`
}

/** A prompt that asks a coding assistant to add the tracker to a site built with the chosen framework or platform. */
export const sitePrompt = (target: SiteTarget, options: SnippetOptions): string => {
  const guide = SITE_GUIDES[target]
  const host = hostOf(options)
  const site = siteOf(options)
  const label = labelOf(SITE_TARGETS, target)
  return `# Add Analytik tracking to your ${label} site

## Goal

Add the Analytik tracker (privacy-first, self-hosted web analytics) to this ${label} site so every page sends pageviews to ${host}. The analytics server is already running; only the website changes. Site id: \`${site}\`, privacy mode: \`${options.mode}\`. If the site id looks like a placeholder, ask me for the real one.

## The snippet

\`\`\`html
${scriptTag(options)}
\`\`\`

## Where to put it in ${label}

${guide.where}

${fence({ path: guide.file, lang: guide.lang, code: guide.code(options) })}${guide.notes ? `\n\n${bullets(guide.notes)}` : ''}

Add it once, site wide. Do not self-host or bundle the script, and do not add a second analytics snippet for the same site.

## Privacy

${bullets(PRIVACY_RULES[options.mode])}

## Goals and revenue

${eventsSection(target, host)}

## Verify

${numbered([
  `Open the site in a normal browser window (the tracker ignores automated browsers) with ad blockers off. The first pageview is sent after the first interaction or 3 seconds of visibility${options.requireInteraction ? '' : ' (here: immediately, interaction is not required)'}.`,
  `In DevTools > Network, filter for \`event\`: a \`POST ${host}/api/event\` request returns **202**. 403 means the page's host is not the site's domain (on localhost add \`data-allow-localhost\` and enable allowLocalhost for the site); 404 means the site id is wrong.`,
  'Open the Analytik dashboard: the visit shows up in Realtime within a few seconds.',
  'If you added goals or revenue, trigger one and check that it appears under Events or Revenue.',
])}
`
}
