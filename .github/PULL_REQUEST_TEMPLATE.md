## What and why

<!-- What this changes, and the problem it solves. Link the issue if there is one. -->

## Checklist

- [ ] `bun run check` passes (format, lint, typecheck, unit tests with coverage)
- [ ] `bun run test:browser` and `bun run test:e2e` pass, if the tracker, the React bindings or the dashboard changed
- [ ] Storage or route changes pass against Postgres (`ANALYTIK_TEST_POSTGRES_URL` set, see CONTRIBUTING.md)
- [ ] New behavior has tests
- [ ] Docs and the README are updated, and `bun run sync:samples` was run if their code samples changed
- [ ] `packages/analytik/CHANGELOG.md` has an entry under `## [Unreleased]`
