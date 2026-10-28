# Contributing

Thanks for helping. Bug reports, docs fixes and pull requests are all welcome.

## Before you start

- For anything bigger than a small fix, open an issue first so we can agree on the approach.
- Privacy defaults are part of the design. A change that stores IP addresses, sets cookies in `strict` mode or sends visitor data to a third party needs an issue first.
- If events don't reach storage, turn on `data-debug` on the tracker script tag and look at the request it sends before you assume the server is at fault.
- If a dashboard number looks wrong, compare it with the raw events for the same period first.

## Setup

You need [Bun](https://bun.sh) 1.3+ and Node.js 22.19+ (the version is in `.node-version`).

```sh
bun install
bunx playwright install chromium firefox webkit   # once, for the browser and e2e tests
bun run dev                                       # demo app, reading the package's source
```

Postgres tests need a database. Start one, for example with Docker, and point the tests at it:

```sh
docker run --rm -d -p 5432:5432 -e POSTGRES_USER=analytik -e POSTGRES_PASSWORD=analytik -e POSTGRES_DB=analytik_test postgres:17
export ANALYTIK_TEST_POSTGRES_URL=postgres://analytik:analytik@localhost:5432/analytik_test
```

Without `ANALYTIK_TEST_POSTGRES_URL` those tests are skipped. CI always runs them against a real Postgres.

## Where things live

- `packages/analytik/src/server`: `createAnalytik()`, the Hono routes, auth and the privacy rules (hashing and salts).
- `packages/analytik/src/storage`: the D1, Postgres, SQLite and in-memory storage, the shared query builders and the ordered migrations.
- `packages/analytik/src/adapters`: the Stripe, Dodo and Lemon Squeezy webhook verification and mapping.
- `packages/analytik/src/tracker`: the browser script, built to `dist/analytik.js`.
- `packages/analytik/src/client`, `src/react`: the browser client and the React bindings.
- `packages/analytik/src/dashboard`: the embeddable dashboard and its styles.
- `packages/analytik/src/cli.ts`: the `analytik` command line.
- `packages/analytik/test`: unit tests (Node and happy-dom), with `test/browser` for the real engines.
- `apps/example`: the demo app, its Playwright tests in `e2e/`, and the type-checked code samples.
- `apps/docs`: the documentation site.

## Checks

```sh
bun run check          # samples in sync, format, lint, typecheck, unit tests with coverage
bun run test:browser   # tracker and dashboard in Chromium, Firefox and WebKit
bun run test:e2e       # builds the demo and drives it with Playwright
bun run build          # fails when a size budget is exceeded
bun run lint:package && bun run test:pack   # after build: publint, types, install the tarball
```

CI runs all of them on every pull request, plus the server tests on Postgres and on the Bun runtime, and the React bindings against the oldest and newest React.

## Conventions

- TypeScript strict. React components are function components with hooks.
- Every behavior change comes with a test. Server tests use the in-memory storage unless the behavior depends on a real database.
- Code samples in `packages/analytik/README.md` and `apps/docs` are type-checked. After editing them, run `bun run sync:samples`.
- Add a line under `## [Unreleased]` in `packages/analytik/CHANGELOG.md` for anything users will notice.
  The file is also shown in Settings → Changelog, so keep entries short: one line per change, no implementation
  detail, and merge related changes of a release into one bullet. Group them as Added, Changed or Fixed.
- Breaking changes need a new major version and an entry under **Changed**.
- Schema changes are new migration files in each dialect folder they affect. Don't edit a migration that has shipped.

## License

By contributing you agree that your contributions are licensed under the MIT license.
