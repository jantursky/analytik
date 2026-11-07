# Changelog

All notable changes to this project are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.21.0]

### Changed

- Dashboard header: a fade and an arrow show on the side where more views are hidden.
- Setup help: the not-found reply names the base path, `/health` shows the failure to admins, `doctor` checks Postgres against its own migrations, and new framework and troubleshooting docs.

## [1.20.0]

### Added

- Journeys view (where sessions go after the first page) and Retention view (weekly cohorts of new visitors, Persistent mode), both admin only.

## [1.19.0]

### Changed

- Site sparklines start at zero and show a faint dashed baseline for it.

## [1.18.0]

### Added

- Share links are made for the Mac menu bar app or as a shared link with a dropdown of views, in Settings → Sharing and Defaults; Select all included.

### Changed

- Share links may read the site icon, so the Mac app shows it.
- The links made in Defaults stay while you switch settings pages.

## [1.17.0]

### Added

- `analytik menubar` installs the Mac menu bar app; Settings → Sharing shows the command and a Get the Mac app button.

## [1.16.0]

### Added

- Settings → Sharing shows a Mac app link next to a new share link, for the Mac menu bar app in `apps/menubar`.
- A "Got an idea?" link under the dashboard opens a new GitHub issue.
- Settings → Defaults sets timezone, currency, privacy, retention and tracking once for new sites, and applies a card to every site after confirming.
- Pausing tracking asks for confirmation.
- Settings → Defaults creates read-only share links for several sites at once, with one text that adds them all to the Mac app.

### Changed

- Settings → Payments and API lists only the payment providers you added; add and remove them in place.

### Fixed

- The site name in a shared dashboard's toolbar is as tall as the other controls.

## [1.15.0]

### Added

- Goal targets in Settings → Goals (a number per week, month or quarter) with progress and an estimate in the overview's Goals block, and `GET /api/sites/:id/targets`. Run `analytik upgrade` to add the new column.
- Core Web Vitals (LCP, INP, CLS), opt in per site and sampled: `data-vitals` loads a 0.5 kB script for sampled page views only, reports ride on the leave beacon, and the Pages view rates the 75th percentile per page. Run `analytik upgrade` to add the new table.

### Changed

- Meters in the channel, source, country, browser, OS and device breakdowns show each row's share of the total; the site switcher is sorted by name; new projects get an `analytik:upgrade` script (`bun upgrade` is a Bun command).

## [1.14.0]

### Added

- About 50 more browsers recognised (Internet Explorer, UC, QQ, Huawei, Mi, Whale, Waterfox, Falkon, in-app browsers and more), most with a mark in the dashboard.
- One payment provider account can feed several sites: a webhook ignores payments for another site (`analytik_site_id` from `attribution()`, a visitor seen only elsewhere, or a renewal another site sold).

## [1.13.0]

### Added

- Share links in Settings → Sharing (named, limited to chosen views, with expiry and revoke, cached by your CDN), read-only shared dashboards, and notes on the charts, also from `POST /api/v1/annotations`. Run `analytik upgrade` to add the new tables.
- Export CSV on every table and breakdown, and Export PNG on every chart.

## [1.12.0]

### Added

- Bots view: which crawlers (AI answers, indexing, training) request which pages, reported by your server with `POST /api/v1/bots`. Run `analytik upgrade` to add the new table.
- Email notifications: payment alerts, a daily or weekly summary and a tracker-down warning, set up in Settings → Email with a sender from `analytik/email` and a schedule (`scheduled()` or `POST /api/v1/cron`). Run `analytik upgrade` to add the new tables.
- Payment webhook adapters for Paddle, Polar, Razorpay, Creem and Gumroad, with their logos.
- "Import from another tool" in the site switcher.

### Security

- Login attempts are counted before the password check, `identify()` no longer rewrites a stored email, name or user id, and API responses are sent with `no-store` and `nosniff`.

## [1.11.1]

### Fixed

- The 1.11.0 release build failed on a currency-order test and never reached npm; 1.11.1 has the same features.

## [1.11.0]

### Added

- Ignore your own visits: IP ranges (CIDR), "Add my current IP", an "ignore this browser" link and an option to ignore signed-in admins. Run `analytik upgrade` to add the new column.
- All sites: a trend line and the change on each card, with a 24 hours / 7 / 30 days picker and Refresh.
- Sessions: show, hide and reorder the table's columns.
- The dashboard remembers your period, comparison and breakdown tabs between visits.
- Brand logos in the Site integration prompt and Import data pickers, a "Copied" toast, and pickers in alphabetical order.

### Fixed

- The Sessions table no longer makes the whole page scroll sideways.
- Correct GoatCounter, Matomo and Dodo Payments logos.

## [1.10.0]

### Added

- Data import from **Matomo**, **GoatCounter**, **Google Analytics 4** (BigQuery export) and **PostHog**, next to Umami and Simple Analytics; platform logos in the import dialog and sample files in Debug.
- `analytik upgrade` prints the Worker size next to Cloudflare's limit; new projects get an `upgrade` script.

## [1.9.2]

### Fixed

- The 1.9.1 release build failed on a slow end-to-end test and never reached npm; 1.9.2 has the same features.

## [1.9.1]

### Fixed

- The 1.9.0 release build failed on two flaky tests and never reached npm; 1.9.1 has the same features.

## [1.9.0]

### Added

- Data import from **Umami** and **Simple Analytics**: Settings → Data → Import data, or `analytik import`. Repeat-safe, removable, kept apart from tracked visits.
- **All sites**: "Add website" is now a menu with **New website** and **Import from another tool** (platform choice, drag and drop, preview, confirmation).
- Copy button for page URLs in Pages, Events, Visitor timeline and the live feed.
- Debug: downloadable sample import files.

### Changed

- Migration `0002_imported` adds an `imported` column to sessions and events (also in exports).
- Average visit duration ignores imported visits with unknown duration.
- Toolbar and dialogs get a divider and shadow only while content scrolls beneath them; dialog headings and buttons stay in view.
- Pause tracking in the site menu is amber, Resume is green; buttons have a hover state.

### Fixed

- Long URLs no longer overflow the live feed.

## [1.8.1]

### Fixed

- 1.8.0 failed its release checks and never reached npm; 1.8.1 has the same features.

## [1.8.0]

### Added

- Command palette (⌘K) and keyboard shortcuts.
- Saved filter segments.
- Compare periods in the toolbar, charts and breakdowns.
- Changelog section in Settings.
- Dashboard translated into 18 languages, with a `locale` prop and a `messages` override.
- With `urlState`, the address also keeps the Settings section, range, interval and filters.

### Changed

- Country flags are round SVG flags (Circle Flags) instead of emoji.
- New default number format, "The language's own".

### Fixed

- No more scrolling past the end of the standalone dashboard.

## [1.7.0]

### Changed

- A shorter Add a website dialog: domain and name first, other options in a collapsible row; a new site starts with the newest site's settings.

## [1.6.0]

### Changed

- The tracker is served at `/js/analytik.js`; the old `/analytik.js` still works in `withDashboard`.

## [1.5.0]

### Added

- Privacy modes explain what they store and whether they need a cookie banner.
- Tracking code: mode descriptions and a prompt for coding assistants.

### Fixed

- Site icon edge in the dark theme.

## [1.4.1]

### Changed

- The Live map follows the dashboard theme.

### Fixed

- Padding of empty and loading states.

## [1.4.0]

### Added

- `urlState` keeps the open site and view in the address.

### Changed

- Smaller footer; no page jump when switching views.

## [1.3.0]

### Added

- Add several overview blocks at once; theme switch in the header.

### Changed

- Debug section only with `debug: true`; spacing and badge fixes.

## [1.2.0]

### Added

- Update notice, `analytik upgrade`, Dependabot config in the templates and server-fetched site icons.
- Theme switch on the login screen.

### Changed

- New login screen and error notes; pause and delete styled as warning and danger.

## [1.1.0]

### Added

- `analytik/standalone` (`withDashboard`), the `analytik create` command and Cloudflare and Vercel templates.
- Dashboard theme setting.

## [1.0.0]

### Added

- Hono server with strict, enriched and persistent privacy modes.
- D1, Postgres, SQLite and in-memory storage.
- Tracker script, ESM client, React bindings and an embeddable dashboard.
- Payments API with Stripe, Dodo and Lemon Squeezy.
- All sites view, pause and delete sites, request savings and debug tools.
