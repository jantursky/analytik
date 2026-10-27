import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { demoApi } from './server/vitePlugin.js'

const lib = (path: string) => fileURLToPath(new URL(`../../packages/analytik/${path}`, import.meta.url))

// The dev server reads the library's source so edits hot-reload across packages.
// Builds and previews resolve `analytik` through node_modules, i.e. the library's real dist output.
export default defineConfig(({ command }) => ({
  plugins: [react(), demoApi()],
  resolve: {
    alias:
      command === 'serve'
        ? [
            { find: /^analytik\/server$/, replacement: lib('src/server') },
            { find: /^analytik\/storage\/memory$/, replacement: lib('src/storage/memory.ts') },
            { find: /^analytik\/client$/, replacement: lib('src/client') },
            { find: /^analytik\/react$/, replacement: lib('src/react') },
            { find: /^analytik\/dashboard\/styles\.css$/, replacement: lib('src/dashboard/styles.css') },
            { find: /^analytik\/dashboard$/, replacement: lib('src/dashboard') },
            { find: /^analytik\/migrate$/, replacement: lib('src/migrate') },
          ]
        : [],
  },
}))
