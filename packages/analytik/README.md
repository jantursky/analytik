<p align="center">
  <img src="https://raw.githubusercontent.com/jantursky/analytik/main/.github/assets/banner.svg" alt="analytik: simple, private, fast web analytics" width="420">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/analytik"><img alt="npm" src="https://img.shields.io/npm/v/analytik"></a>
  <a href="https://github.com/jantursky/analytik/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/jantursky/analytik/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://codecov.io/gh/jantursky/analytik"><img alt="coverage" src="https://codecov.io/gh/jantursky/analytik/graph/badge.svg"></a>
  <img alt="types" src="https://img.shields.io/npm/types/analytik">
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/npm/l/analytik"></a>
</p>

<p align="center">
  <a href="https://analytik-docs.vercel.app">Docs</a> ·
  <a href="https://analytik.vercel.app">Demo</a> ·
  <a href="https://www.npmjs.com/package/analytik">npm</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

# analytik

Web analytics you host yourself. The default `strict` mode is designed to avoid needing a cookie banner (see the [privacy page](https://analytik-docs.vercel.app/concepts/privacy-modes) for the conditions). A Hono server for Cloudflare Workers, Vercel, Railway, Bun or Node, storage on D1, Postgres (Supabase) or SQLite, a 4 KB tracker, React bindings and a dashboard you can embed.

<a href="https://analytik.vercel.app/#dashboard">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/jantursky/analytik/main/.github/assets/dashboard-dark.png">
    <img alt="The analytik dashboard: visitors, revenue and a breakdown by source, page and device" src="https://raw.githubusercontent.com/jantursky/analytik/main/.github/assets/dashboard-light.png">
  </picture>
</a>

<p>
<a href="https://analytik.vercel.app/#dashboard"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/jantursky/analytik/main/.github/assets/live-dark.png">
  <img alt="The live view: a map of who is on the site now and what they just did" src="https://raw.githubusercontent.com/jantursky/analytik/main/.github/assets/live-light.png" width="49%">
</picture></a>
<a href="https://analytik.vercel.app/#dashboard"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/jantursky/analytik/main/.github/assets/revenue-dark.png">
  <img alt="Revenue: totals, revenue over time, revenue by channel and the payments list" src="https://raw.githubusercontent.com/jantursky/analytik/main/.github/assets/revenue-light.png" width="49%">
</picture></a>
</p>

## What you get

- **Strict mode by default.** The tracker stores no identifier on the visitor's device and no IP address is kept. The visitor id is a pseudonymous hash of IP, user agent and site, salted with a random value that is removed from the live database once the next month starts. Do Not Track visitors are still counted, in strict mode. Strict mode is designed to avoid needing consent, which is not legal advice.
- **Two more modes when you need them.** `enriched` adds a per-tab id after the visitor consents. `persistent` uses first-party cookies like most analytics tools do, and should be treated as needing consent in the EU.
- **Revenue.** A payments API with refunds, optional Stripe, Dodo and Lemon Squeezy webhook adapters, and attribution to the visit that brought the buyer.
- **Goals, funnels, campaigns, realtime**, JSON and CSV export, retention, share links (read-only, set through the API).
- **One server, three databases.** It runs on D1, Postgres and SQLite, and the tests run every case against each of them.

## Install

```sh
bun add analytik hono
```

## A server in a dozen lines

```ts sample
import { createAnalytik } from 'analytik/server'
import { d1Storage } from 'analytik/storage/d1'

interface Env {
  DB: Parameters<typeof d1Storage>[0]
  ADMIN_PASSWORD: string
  SESSION_SECRET: string
}

export default {
  fetch(request: Request, env: Env) {
    const { app } = createAnalytik({
      storage: d1Storage(env.DB),
      admin: { password: env.ADMIN_PASSWORD, secret: env.SESSION_SECRET },
    })
    return app.fetch(request, env)
  },
}
```

Then add the tracker to your site:

```html
<script defer src="https://analytics.example.com/analytik.js" data-site="my-site" data-mode="strict"></script>
```

Track an event or a sale from your own code:

```ts sample
import { createClient } from 'analytik/client'

const analytik = createClient({ site: 'my-site', api: 'https://analytics.example.com/api' })

analytik.track('signup', { plan: 'pro' })
analytik.revenue('purchase', 49.9, { currency: 'EUR', orderId: '1042' })
```

## How it works

1. The tracker (`src/tracker`) sends pageviews, engaged time, outbound clicks and your events to `POST /api/event`, using a `text/plain` beacon so no preflight is needed.
2. The server (`src/server`) checks the origin against the site's domain, drops bots, and computes the visitor id with the monthly salt.
3. Sessions, events and payments land in the storage adapter you chose (`src/storage`).
4. Payments arrive through `POST /api/v1/payments` or a provider webhook (`src/adapters`) and are matched to the visit that led to them.
5. The dashboard (`src/dashboard`) reads the admin API. Embed `<Dashboard />` in your own app or use the one in the demo.

## Deploy

| Where                                                                                   | Storage                   | Good for                                |
| --------------------------------------------------------------------------------------- | ------------------------- | --------------------------------------- |
| [**Cloudflare Workers**](https://analytik-docs.vercel.app/deploy/cloudflare-workers-d1) | D1                        | The free plan, no server to run (below) |
| [**Vercel**](https://analytik-docs.vercel.app/deploy/vercel-supabase)                   | Supabase or Neon Postgres | Already hosting your site on Vercel     |
| [**Railway**](https://analytik-docs.vercel.app/deploy/railway-postgres)                 | Railway Postgres          | A long-running service with a database  |
| [**Bun or Node**](https://analytik-docs.vercel.app/deploy/bun-node-sqlite)              | SQLite file               | A VPS or a Docker container             |

### Cloudflare in five minutes

A Worker with a D1 database fits the free plan for small sites.

```bash
mkdir analytik-worker && cd analytik-worker
bun add analytik hono && bun add -d wrangler @cloudflare/workers-types typescript
mkdir -p public src && cp node_modules/analytik/dist/analytik.js public/analytik.js
```

```ts
// src/worker.ts
import { createAnalytik } from 'analytik/server'
import { d1Storage } from 'analytik/storage/d1'

interface Env {
  DB: D1Database
  ADMIN_PASSWORD: string
  SESSION_SECRET: string
}

let app: ReturnType<typeof createAnalytik>['app'] | undefined

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    app ??= createAnalytik({
      storage: d1Storage(env.DB),
      admin: { password: env.ADMIN_PASSWORD, secret: env.SESSION_SECRET },
    }).app
    return app.fetch(request, env, ctx)
  },
}
```

```jsonc
// wrangler.jsonc
{
  "name": "analytik",
  "main": "src/worker.ts",
  "compatibility_date": "2026-10-01",
  "assets": { "directory": "./public", "run_worker_first": ["/api/*"] },
  "d1_databases": [{ "binding": "DB", "database_name": "analytik", "database_id": "<id from the next step>" }],
}
```

```bash
npx wrangler d1 create analytik              # copy database_id into wrangler.jsonc
npx wrangler secret put ADMIN_PASSWORD       # the dashboard password
npx wrangler secret put SESSION_SECRET       # openssl rand -hex 32
npx wrangler deploy
```

The schema is created on the first request. Then create a site through the admin API (replace the host with your Worker URL):

```bash
curl -c cookies.txt -X POST https://analytik.<you>.workers.dev/api/auth/login \
  -H 'Content-Type: application/json' -d '{"password":"<ADMIN_PASSWORD>"}'
curl -b cookies.txt -X POST https://analytik.<you>.workers.dev/api/sites \
  -H 'Content-Type: application/json' -d '{"name":"My site","domain":"example.com"}'
```

Add `<script defer src="https://analytik.<you>.workers.dev/analytik.js" data-site="SITE_ID"></script>` to your pages, with the `site.id` from the response. The Worker serves the API and the tracker, not a dashboard page: [embed `<Dashboard />`](https://analytik-docs.vercel.app/guides/dashboard-embedding) in a React app (the [demo](https://analytik.vercel.app) is one) to see the numbers. A custom domain, the free-plan limits and a first-party route for ad blockers are in the [full Cloudflare guide](https://analytik-docs.vercel.app/deploy/cloudflare-workers-d1).

## Alternatives

[Plausible](https://plausible.io) and [Umami](https://umami.is) are good, mature alternatives if you prefer a bigger project.

## Support

Browsers: the tracker targets ES2020, so any evergreen browser. Runtimes: Cloudflare Workers, Bun 1.3+, Node 22.19+, Vercel Functions. The dashboard and React bindings need React 19.

## Contributing

See [CONTRIBUTING.md](https://github.com/jantursky/analytik/blob/main/CONTRIBUTING.md). Security notes are in [SECURITY.md](https://github.com/jantursky/analytik/blob/main/SECURITY.md).

## License

[MIT](LICENSE)
