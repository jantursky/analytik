import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Server-side suites (shared, server, storage, adapters, migrate, cli) run in plain Node; the browser parts
// (tracker, client, react, dashboard) get happy-dom. Real browsers run in vitest.browser.config.ts.
const NODE_TESTS = ['test/{shared,server,storage,adapters,migrate,cli}-*.test.ts']
const SERVER_SOURCES = 'src/{shared,server,storage,adapters,migrate}/**/*.ts'
const GATE = { statements: 92, branches: 85, functions: 95, lines: 95 }

export default defineConfig({
  plugins: [react()],
  resolve: {
    // The library build generates this module (the dashboard app as strings); tests get a small stand-in.
    alias: {
      'virtual:analytik-standalone': fileURLToPath(new URL('test/helpers/standalone-assets.ts', import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: NODE_TESTS,
          globalSetup: ['test/helpers/postgres-setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'happy-dom',
          include: ['test/**/*.test.{ts,tsx}'],
          exclude: [...NODE_TESTS, 'test/browser/**'],
        },
      },
      // Type tests for the public API: `expectTypeOf` only, checked by tsc, nothing runs.
      {
        extends: true,
        test: {
          name: 'types',
          include: [],
          typecheck: { enabled: true, include: ['test/types/**/*.test-d.ts'] },
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      // types.ts is declarations only; the CLI runs in a child process in its tests, where coverage can't see it. The
      // PNG encoder draws to a canvas, which happy-dom cannot, so test/browser runs it in real browsers.
      exclude: [
        'src/index.ts',
        'src/shared/types.ts',
        'src/cli.ts',
        'src/standalone/main.tsx',
        'src/dashboard/chart-export.ts',
      ],
      reporter: ['text-summary', 'text', 'html', 'lcov'],
      thresholds: {
        [SERVER_SOURCES]: GATE,
        'src/{tracker,client,react,dashboard}/**/*.{ts,tsx}': GATE,
      },
    },
  },
})
