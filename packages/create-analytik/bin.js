#!/usr/bin/env node
// `npm create analytik my-stats` runs this. The work is done by the analytik command line; this only starts it, so
// the project is always made by the latest release.
import { spawnSync } from 'node:child_process'

const result = spawnSync('npx', ['--yes', 'analytik@latest', 'create', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
process.exitCode = result.status ?? 1
