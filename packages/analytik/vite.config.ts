import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import react from '@vitejs/plugin-react'
import { type Plugin, build, defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

const root = (path: string): string => resolve(import.meta.dirname, path)

// One entry per subpath export in package.json; `storage/d1` builds to dist/storage/d1.js.
const entries = {
  // Server side: runs on Workers, Vercel, Bun and Node.
  index: 'src/index.ts',
  server: 'src/server/index.ts',
  'storage/d1': 'src/storage/d1.ts',
  'storage/postgres': 'src/storage/postgres.ts',
  'storage/sqlite': 'src/storage/sqlite.ts',
  'storage/memory': 'src/storage/memory.ts',
  'adapters/stripe': 'src/adapters/stripe.ts',
  'adapters/dodo': 'src/adapters/dodo.ts',
  'adapters/lemonsqueezy': 'src/adapters/lemonsqueezy.ts',
  migrate: 'src/migrate/index.ts',
  cli: 'src/cli.ts',
  // Browser side. The tracker script (dist/analytik.js) is a separate IIFE build below.
  client: 'src/client/index.ts',
  react: 'src/react/index.ts',
  dashboard: 'src/dashboard/index.ts',
}

const PEERS = ['hono', 'pg', 'postgres', 'react', 'react-dom', '@base-ui/react', 'recharts', 'motion']
const isExternal = (id: string): boolean =>
  /^(node|bun|cloudflare):/.test(id) || PEERS.some((name) => id === name || id.startsWith(`${name}/`))

/** The dashboard stylesheet ships as-is: plain CSS variables, nothing to compile. */
function dashboardCss(): Plugin {
  return {
    name: 'analytik:dashboard-css',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'dashboard.css',
        source: readFileSync(root('src/dashboard/styles.css')),
      })
    },
  }
}

/** `<script src=".../analytik.js">`: a self-contained IIFE with no imports, built after the library. */
function trackerScript(): Plugin {
  return {
    name: 'analytik:tracker',
    apply: 'build',
    async closeBundle() {
      await build({
        configFile: false,
        logLevel: 'warn',
        build: {
          outDir: root('dist'),
          emptyOutDir: false,
          target: 'es2020',
          minify: true,
          lib: {
            entry: root('src/tracker/tracker.ts'),
            formats: ['iife'],
            name: 'analytikTracker',
            fileName: () => 'analytik.js',
          },
        },
      })
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    dts({ tsconfigPath: './tsconfig.build.json', include: ['src'], bundleTypes: true }),
    dashboardCss(),
    trackerScript(),
  ],
  build: {
    lib: {
      entry: Object.fromEntries(Object.entries(entries).map(([name, path]) => [name, root(path)])),
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`,
    },
    rollupOptions: {
      external: isExternal,
      output: {
        // The 'use client' directives of the react and dashboard entries are kept from their sources.
        banner: (chunk) => (chunk.name === 'cli' ? '#!/usr/bin/env node' : ''),
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
    sourcemap: true,
    minify: true,
    target: 'es2022',
    emptyOutDir: true,
  },
})
