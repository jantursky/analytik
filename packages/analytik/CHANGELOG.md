# Changelog

All notable changes to this project are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Settings, Privacy: each privacy mode shows whether it needs a cookie banner and, on hover or focus, what it stores
  on the device and the server, how the visitor id is made and its limits.
- Settings, Tracking code: the Mode list explains each mode, and a new Site integration prompt copies instructions for a
  coding assistant that adds the tracker in the right file for the chosen framework.

### Fixed

- A site icon no longer shows a thin edge of its tile colour in the dark theme.

## [1.4.1]

### Changed

- The Live map and its cards follow the dashboard theme (light by default, dark in a dark dashboard). The Light map
  button is gone.

### Fixed

- Empty and loading states had their padding overridden by the reset and sat flush against the card.

## [1.4.0]

### Added

- `urlState` on `<Dashboard>`: keeps the open site and view in the address (`?site=<id>&section=pages`), so a refresh,
  a bookmark or a shared link opens the same place and Back steps through the views. The standalone dashboard turns it
  on; an embedded one leaves the host page's address alone.

### Changed

- Smaller footer without the brand mark, name and tagline.
- Switching views no longer holds the page height for a moment, which made the page jump.

## [1.3.0]

### Added

- Several blocks can be added to the overview at once: the block picker takes any number of picks.
- Theme switch in the dashboard header, next to Log out.

### Changed

- Blocks already on the overview are faded, grey and dashed in the block picker.
- The Debug section of Settings shows only when the server runs with `debug: true`.
- The formatting preview is laid out as tiles.
- Empty states have more padding, the live count more space after the dot, and the paused badge on a site card no
  longer covers the name.

## [1.2.0]

### Added

- Update notice in the dashboard: a dismissible bar says when a newer version is on npm. Dismissing it hides that
  version only. `GET /version` backs it, and `updateCheck: false` turns the check off.
- `analytik upgrade [dir]` installs the latest version into a project and redeploys it (Cloudflare).
- Dependabot configuration in the Cloudflare and Vercel templates, limited to `analytik`.
- Theme switch on the standalone login and add-website screens.
- Site icons are fetched on the server (`GET /sites/:id/favicon`), so sites without `/favicon.ico` get their icon.

### Changed

- Redesigned login screen and error notes (icon, title, accent edge, animation).
- Pause tracking uses a warning style and Delete website a danger style, both with icons.
- The header content lines up with the main column.
- The name is written as Analytik everywhere, and the page title and icon use the brand mark.

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
