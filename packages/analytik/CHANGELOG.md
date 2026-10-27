# Changelog

All notable changes to this project are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.1.0]

### Added

- `analytik/standalone`: `withDashboard(app)` serves the dashboard and the tracker script in front of an analytik app,
  so a single Worker or server needs no separate dashboard app.
- `analytik create [dir]` makes a Cloudflare project from a template, installs it, signs in, creates the D1 database,
  deploys and sets the secrets (`--no-deploy` writes the files only). `--target vercel` writes a Vercel project instead.
- Cloudflare and Vercel project templates, with Deploy to Cloudflare and Deploy with Vercel buttons.
- Dashboard theme setting (Settings, Appearance): the page's `data-theme`, light or dark. A light theme set on the page
  now also wins over a dark system setting.

## [1.0.0]

### Added

- Hono server with strict (cookieless), enriched and persistent privacy modes.
- Storage adapters for Cloudflare D1, Postgres (Supabase), SQLite and in-memory.
- Tracker script, ESM client and React bindings.
- Embeddable React dashboard.
- Generic payments API with Stripe, Dodo and Lemon Squeezy adapters.
- All sites view with per-site visitors, revenue and orders from one `GET /summary` request, sortable by date
  added, name, domain, visitors, revenue or orders.
- Site lifecycle: pause and resume tracking, delete a site after confirming its domain and the admin password.
- Tracking code settings open right after a site is added.
- Tracker activity updates every 4 minutes by default, set with `data-ping-interval` (or `pingInterval`) and an
  "Activity updates" choice in the snippet generator.
- Debug tools behind `debug: true`: generate test sites with traffic and payments, including a realistic mix of
  busy, quiet, empty and paused sites, and remove them again.
- Dashboard request savings for small free tiers: a one-minute client cache that also merges identical requests,
  live numbers polled every minute, and live views that poll less often while nothing changes and pause in
  background tabs.
