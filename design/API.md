# analytik: API and architecture note

Privacy-first web analytics you host yourself. One package (`analytik`), runtime-agnostic server (Hono), pluggable storage (Cloudflare D1, Postgres/Supabase, SQLite, in-memory), a tiny tracker script, React bindings and an embeddable React dashboard.

Out of scope: hosted multi-tenant SaaS, Google sign-in, plan billing.

## Package layout (`packages/analytik`)

```
src/
  shared/      types.ts (contract), channels.ts (source -> channel), ids.ts, time.ts, ua.ts, url.ts
  server/      createAnalytik(), routes: collect, attribution, payments, goals, admin, stats; auth; privacy (strict hashing, salts)
  storage/     d1.ts, postgres.ts, sqlite.ts, memory.ts, sql/ (shared query builders), migrations/ (ordered .sql per dialect)
  adapters/    stripe.ts, dodo.ts, lemonsqueezy.ts (webhook verify + map to PaymentInput)
  tracker/     tracker.ts -> dist/analytik.js (IIFE, <4 KB gzip)
  client/      browser ESM API (init, track, identify, revenue, attribution, consent, optOut)
  react/       AnalytikProvider, useAnalytik, useTrackPageviews, <TrackClick>
  dashboard/   <Dashboard> and parts (Overview, Sources, Pages, Events, Revenue, Sessions, Realtime), createApiClient()
  cli.ts       bin `analytik`: init, migrate (db schema), seed, doctor
  index.ts     re-exports shared types only
```

### Subpath exports

`analytik` (types), `analytik/server`, `analytik/storage/d1`, `/storage/postgres`, `/storage/sqlite`, `/storage/memory`, `analytik/adapters/stripe`, `/adapters/dodo`, `/adapters/lemonsqueezy`, `analytik/client`, `analytik/react`, `analytik/dashboard`, `analytik/dashboard/styles.css`, `analytik/tracker` (path to script via `analytik/tracker.js` asset), `./package.json`. ESM only. Peer deps (all optional except the one you use): `hono`, `react`, `react-dom`, `pg` or `postgres`. Zero runtime dependencies in the tracker and client.

## Privacy modes

| mode         | device storage                                                   | visitor id                                            | consent banner |
| ------------ | ---------------------------------------------------------------- | ----------------------------------------------------- | -------------- |
| `strict`     | none                                                             | server: `HMAC(monthSalt, siteId + ip + ua)` truncated | not needed     |
| `enriched`   | `sessionStorage` id after `consent()`                            | server hash plus tab id                               | after consent  |
| `persistent` | first-party cookies `analytik_vid` (1y), `analytik_sid` (30 min) | random uuid                                           | required in EU |

Default `strict`. Rules:

- IP is read from the request and never stored. Location comes from edge headers (`cf-ipcountry` and `request.cf`, Vercel `x-vercel-ip-*`), else null. Coordinates rounded to 2 decimals.
- The salt is random, created per UTC month, stored in table `salts` and deleted when the month ends (a purge runs on each write path, no cron needed). Deleting it makes past visitor ids unlinkable.
- Query strings and fragments are stripped from page paths by default, except campaign keys (`utm_*`, `ref`, `source`). Option `keepQuery: string[]` allows more. Private params (`email`, `token`, ...) are always dropped.
- Do Not Track and Global Privacy Control are honoured in `enriched` and `persistent` modes by default.
- Bots filtered by user agent and `navigator.webdriver`. The tracker sends the first pageview only after the first interaction or 3 s of visibility (`requireInteraction`, default true).
- `strict` limits (documented): visitor changing network counts twice; same IP + UA counts once; no cross-month history; `identify()` and email matching are ignored unless consent was given or the integrator posts the email from the server.

## Server

```ts
import { createAnalytik } from 'analytik/server'
import { d1Storage } from 'analytik/storage/d1'

const analytik = createAnalytik({
  storage: d1Storage(env.DB),
  admin: { password: env.ADMIN_PASSWORD, secret: env.SESSION_SECRET },
  privacy: { mode: 'strict' }, // default per site, overridable per site in the DB
  allowedOrigins: 'site-domains', // default: only the registered site domain and its subdomains
})
export default analytik.app // a Hono app: fetch handler for Workers, Bun, Node (@hono/node-server), Vercel
```

`CreateAnalytikOptions`: `storage`, `admin` (`{ password, secret }` or `{ verify(request): Promise<boolean> }`), `privacy`, `allowedOrigins`, `basePath` (default `/api`), `now?` and `random?` for tests, `geo?(request)`.

Returns `{ app: Hono, storage, ingest(event), recordPayment(input), stats: StatsApi }` so server code can call it directly (SSR, queues).

### HTTP routes (all under `basePath`)

Public (CORS open, `text/plain` bodies allowed so no preflight):

- `POST /event` — tracker payload (below). 202 on accept or on filtered bot, 400/403/404/413 otherwise. Max 8 KB.
- `POST /attribution` — returns `{ visitorId, sessionId }` computed server side for the caller (strict mode checkout metadata). Rate limited by the storage layer (simple fixed window per hash).
- `POST /v1/payments` — Bearer site API key. Body `PaymentInput`. Idempotent on `(siteId, id)`.
- `POST /v1/goals` — Bearer site API key. Server-side goal/event (`name`, `props`, `visitorId?|email?`).
- `POST /webhooks/:provider/:siteId` — provider in `stripe | dodo | lemonsqueezy`; verified with the per-site secret; maps to `PaymentInput`.

Admin (cookie session from `POST /auth/login`, or `Authorization: Bearer <admin token>`):

- `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
- `GET/POST /sites`, `GET/PATCH/DELETE /sites/:id`, `POST /sites/:id/rotate-key`
- `GET /sites/:id/overview?from&to&interval&tz&filter...` → `Overview`
- `GET /sites/:id/timeseries` → `TimeseriesPoint[]` (visitors, sessions, pageviews, revenue)
- `GET /sites/:id/breakdown?dimension=...` → `BreakdownRow[]`; dimensions: `channel source referrer campaign medium term content ref page entry exit country region city browser os device event outbound goal`
- `GET /sites/:id/realtime` → `Realtime` (visitors in last 5 min, recent events, recent locations)
- `GET /sites/:id/sessions`, `GET /sites/:id/sessions/:sid` (cursor pagination)
- `GET /sites/:id/events?name=` → paged events
- `GET/POST/DELETE /sites/:id/funnels`, `GET /sites/:id/funnels/:fid` → `FunnelResult`
- `GET /sites/:id/payments`, `POST /sites/:id/rematch`
- `GET /sites/:id/export?format=json|csv` — all data for backup
- `DELETE /sites/:id/data?before=` — retention purge

Filters: query keys `country=DE&channel=Organic Search&page=/pricing`, repeatable, same names as dimensions. Dates ISO 8601; `tz` IANA, default the site timezone. Intervals `hour|day|week|month`.

### Tracker payload (`POST /event`), compact keys

`{ w: siteId, t: 'pageview'|'goal'|'outbound'|'ping'|'identify'|'revenue', u: url, r?: referrer, vid?, sid?, sw?: screenWidth, n?: name, p?: props, d?: engagedMs, a?: amount, c?: currency, o?: orderId, m?: 'strict'|'enriched'|'persistent' }`. `vid`/`sid` are required only in `persistent` mode; in `strict` the server derives them. Revenue events (`t: 'revenue'`) are stored as payments with `provider: 'client'` and de-duplicated by `o`.

## Data model

Same logical tables in every dialect (SQL files per dialect in `storage/migrations/{sqlite,postgres}/`, D1 uses the sqlite dialect):

`sites`(id, name, domain, timezone, currency, privacy_mode, api_key_hash, webhook_secrets json, retention_days, created_at) ·
`visitors`(site_id, id, first_seen, user_id, name, email) ·
`sessions`(attribution, device and geo fields, including `lat`, `lon`) ·
`events`(id, site_id, session_id, visitor_id, ts, type, name, path, props json) ·
`payments`(id, site_id, provider, ts, amount minor units, kind payment|refund, currency, visitor_id, session_id, customer_id, email, name, renewal, matched_by, subscription_id, order_id) ·
`payment_claims` · `funnels` · `salts`(month, value) · `schema_migrations`(version, applied_at).

Failed logins are counted in an internal rate-limit table (`rate_limits`).

## Storage interface

```ts
interface Storage {
  readonly dialect: 'sqlite' | 'postgres' | 'memory'
  migrate(): Promise<MigrationResult> // applies pending migrations, idempotent
  query<T>(sql: string, params?: unknown[]): Promise<T[]>
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>
  batch(statements: Statement[]): Promise<void> // atomic where the driver allows
  close?(): Promise<void>
}
```

Query builders in `storage/sql/` take the dialect for the few differences (placeholders, upsert, date bucketing, JSON). `memory` is a real in-process SQLite (via `node:sqlite` or `bun:sqlite`, wasm sqlite in the browser demo) so tests exercise real SQL.

## Payments

`PaymentInput { id, amount (minor units), currency, kind?, email?, customerId?, subscriptionId?, visitorId?, sessionId?, renewal?, ts?, name?, orderId?, siteId (path/key derived) }`.

Attribution order (`matched_by`): `metadata` (visitorId/sessionId present) → `return_page` (claim posted by the tracker when the return URL carries `payment_id`/`session_id`/`subscription_id`) → `customer` (earlier payment of the same customer) → `email` (identify or server-supplied) → `timing` (exactly one checkout click in the previous 3 h; needs `persistent` or `enriched`). Credit goes to the visitor's last non-direct session. Refunds are stored negative and subtract from revenue. Adapters only verify and map: Stripe (`checkout.session.completed`, `invoice.paid`, `charge.refunded`; HMAC-SHA256 `Stripe-Signature`), Dodo (`payment.succeeded`, `refund.succeeded`; Standard Webhooks), Lemon Squeezy (`order_created`, `subscription_payment_success`, `order_refunded`; `X-Signature`). Tracker helper `analytik.attribution()` → `{ analytik_visitor_id, analytik_session_id }` to put in checkout metadata (Stripe `client_reference_id`/metadata, Dodo `metadata_*` link params, Lemon Squeezy `checkout[custom]`).

## Tracker and client

Script tag (new):

```html
<script defer src="https://analytics.example.com/analytik.js" data-site="SITE_ID" data-mode="strict"></script>
```

Attributes: `data-site`, `data-api` (default origin of src + `/api/event`), `data-mode`, `data-allow-localhost`, `data-domain`, `data-require-interaction`, `data-keep-query`, `data-debug`, `data-auto-outbound` (default true), `data-auto-track-attrs` (default true).

`?analytik_ignore=true` opts the browser out (stored in `localStorage` as `analytik_ignore`); `?analytik_ignore=false` undoes it. A payload without `m` is treated as `strict`.

Global API: `analytik(cmd, ...args)` and methods `analytik.track(name, props?)`, `.revenue(name, amount, { currency, orderId, ...props })`, `.identify({ userId, email, name })`, `.pageview()`, `.attribution()`, `.consent()`, `.withdrawConsent()`, `.optOut()`, `.optIn()`. Declarative: `data-analytik-event="signup"` plus `data-analytik-*` props on any element. Calls made before the script loads are queued (`analytik.q`).

ESM client (`analytik/client`): `createClient({ site, api, mode, ... })` returning the same methods, SSR safe (no-op without `window`).

React (`analytik/react`): `<AnalytikProvider client | site api mode>`, `useAnalytik()`, `useTrackPageviews()` (listens to history; works with React Router and TanStack Router location prop), `<TrackClick event props>`.

## Dashboard (`analytik/dashboard`)

`<Dashboard api="/api" siteId? />` talks to the admin routes with cookie auth (login form included, `<Dashboard fetcher>` to inject). Parts exported individually. Styles: `analytik/dashboard/styles.css`, CSS variables only (tokens from `design/DESIGN.md`, `--analytik-*` prefix mapped to the design tokens), light and dark via `prefers-color-scheme` and `[data-theme]`. Base UI, Motion and Recharts are optional peer dependencies of this subpath; the chart code and Recharts load lazily with the first chart. Views: Overview (visitors, sessions, pageviews, bounce, duration, revenue, conversion, revenue per visitor with period delta, chart), Sources, Pages (top, entry, exit), Events and goals, Funnels, Revenue (by channel/source/campaign/page/country), Sessions and visitor timeline, Realtime, Settings (site, snippet, privacy mode, allowed domains, API key, webhooks, retention, export, ignored IPs).

## Features (v1)

Strict mode, enriched/consent upgrade, opt-out API, Do Not Track/GPC, data retention + purge, JSON/CSV export, ignored IP list, allowed-domain enforcement with localhost toggle, funnels, campaign link builder, revenue API with refunds, three payment adapters, Postgres + SQLite + D1, in-memory storage for tests, Vercel geo headers, health endpoint (`GET /health`), `analytik doctor` self-check, public/shareable read-only dashboard link per site (token), email-free by design.

Deferred (documented as gaps): data imports from other tools, MCP server, UTM link shortener, A/B testing, session replay.
