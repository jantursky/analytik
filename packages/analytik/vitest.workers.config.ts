import { defineConfig } from 'vitest/config'

// The server and D1 adapter on a real workerd (Miniflare). Separate from vitest.config.ts so `bun run check` and
// `bun run test` never start it; run it with `bun run test:workers`.
export default defineConfig({
  test: {
    name: 'workers',
    environment: 'node',
    include: ['test/workers/*.spec.ts'],
    testTimeout: 30_000,
  },
})
