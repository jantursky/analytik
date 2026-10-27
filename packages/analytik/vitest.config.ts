import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Server-side suites (shared, server, storage, adapters, migrate, cli) run in plain Node; the browser parts
// (tracker, client, react, dashboard) get happy-dom. Real browsers run in vitest.browser.config.ts.
const NODE_TESTS = ['test/{shared,server,storage,adapters,migrate,cli}-*.test.ts']
const SERVER_SOURCES = 'src/{shared,server,storage,adapters,migrate}/**/*.ts'
const GATE = { statements: 92, branches: 78, functions: 95, lines: 95 }

export default defineConfig({
  plugins: [react()],
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
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      // types.ts is declarations only; the CLI runs in a child process in its tests, where coverage can't see it.
      exclude: ['src/index.ts', 'src/shared/types.ts', 'src/cli.ts'],
      reporter: ['text-summary', 'text', 'html', 'lcov'],
      thresholds: {
        [SERVER_SOURCES]: GATE,
        'src/{tracker,client,react,dashboard}/**/*.{ts,tsx}': GATE,
      },
    },
  },
})
