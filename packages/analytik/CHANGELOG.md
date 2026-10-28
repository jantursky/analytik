# Changelog

All notable changes to this project are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

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
