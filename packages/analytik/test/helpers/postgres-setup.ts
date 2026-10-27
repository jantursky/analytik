// Starts a throwaway Postgres cluster for the storage and server suites when Postgres binaries are installed.
// Set ANALYTIK_TEST_POSTGRES_URL to use an existing server instead; without either, the Postgres tests skip.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { TestProject } from 'vitest/node'

declare module 'vitest' {
  export interface ProvidedContext {
    postgres: string | null
  }
}

function hasBinary(name: string): boolean {
  try {
    execFileSync(name, ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export default function setup(project: TestProject): (() => void) | undefined {
  const external = process.env.ANALYTIK_TEST_POSTGRES_URL
  if (external) {
    project.provide('postgres', external)
    return undefined
  }
  if (!hasBinary('initdb') || !hasBinary('pg_ctl')) {
    project.provide('postgres', null)
    return undefined
  }
  const dir = mkdtempSync(join(tmpdir(), 'analytik-pg-'))
  const data = join(dir, 'data')
  const port = String(20000 + Math.floor(Math.random() * 20000))
  execFileSync('initdb', ['-D', data, '-U', 'postgres', '-A', 'trust', '--no-sync'], { stdio: 'ignore' })
  execFileSync(
    'pg_ctl',
    ['-D', data, '-w', '-l', join(dir, 'log'), '-o', `-p ${port} -k ${dir} -c listen_addresses= -F`, 'start'],
    { stdio: 'ignore' },
  )
  project.provide('postgres', `postgres://postgres@localhost:${port}/postgres?host=${encodeURIComponent(dir)}`)
  return () => {
    execFileSync('pg_ctl', ['-D', data, '-w', '-m', 'immediate', 'stop'], { stdio: 'ignore' })
    rmSync(dir, { recursive: true, force: true })
  }
}
