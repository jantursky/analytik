import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { type Server, createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { sqliteStorage } from '../src/storage/sqlite'

const packageDir = fileURLToPath(new URL('..', import.meta.url))
const { version } = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as { version: string }

interface Run {
  code: number
  stdout: string
  stderr: string
}

/** Runs the CLI from source in its own process, like `npx analytik` would. */
function cli(...args: string[]): Promise<Run> {
  return new Promise((resolve) => {
    execFile('bun', ['src/cli.ts', ...args], { cwd: packageDir }, (error, stdout, stderr) => {
      resolve({ code: error ? Number(error.code ?? 1) : 0, stdout, stderr })
    })
  })
}

const temp = (name: string) => join(mkdtempSync(join(tmpdir(), 'analytik-cli-')), name)

let health: Server
let healthUrl = ''

beforeAll(async () => {
  health = createServer((request, response) => {
    const ok = request.url === '/api/health'
    response.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok }))
  })
  await new Promise<void>((resolve) => health.listen(0, '127.0.0.1', resolve))
  const address = health.address()
  healthUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
})

afterAll(() => {
  health.close()
})

describe('analytik CLI', { timeout: 30_000 }, () => {
  it('prints usage and the version', async () => {
    const help = await cli('--help')
    expect(help.code).toBe(0)
    expect(help.stdout).toContain('seed --db <url> [--days 30] [--seed 1]')
    expect(help.stdout).not.toContain('import')
    expect((await cli()).stdout).toContain('Usage: analytik')
    expect((await cli('--version')).stdout.trim()).toBe(version)
  })

  it('rejects unknown commands and options with exit code 2', async () => {
    const unknown = await cli('launch')
    expect(unknown.code).toBe(2)
    expect(unknown.stderr).toContain('Unknown command "launch"')
    expect((await cli('migrate', '--nope')).code).toBe(2)
    expect((await cli('migrate')).stderr).toContain('Missing --db')
    expect((await cli('seed', '--db', ':memory:', '--days', 'many')).stderr).toContain('--days must be a whole number')
  })

  it('prints an entry file for each target', async () => {
    expect((await cli('init')).stdout).toContain('d1Storage(env.DB)')
    expect((await cli('init', '--target', 'vercel')).stdout).toContain(
      'postgresStorage(postgres(process.env.DATABASE_URL',
    )
    const bun = await cli('init', '--target', 'bun')
    expect(bun.stdout).toContain('password: Bun.env.ADMIN_PASSWORD!,')
    expect(bun.stdout).not.toContain("?? ''")
    expect(bun.stderr).toContain('Set ADMIN_PASSWORD and SESSION_SECRET')
    expect((await cli('init', '--target', 'node')).stdout).toContain("from '@hono/node-server'")
    expect((await cli('init', '--target', 'deno')).code).toBe(2)
  })

  it('migrates, seeds and checks a SQLite database', async () => {
    const db = temp('analytik.db')
    expect((await cli('doctor', '--db', db)).stdout).toContain('✗ schema not up to date')
    const migrate = await cli('migrate', '--db', db)
    expect(migrate).toMatchObject({ code: 0, stdout: 'Applied 0001_init\n' })
    expect((await cli('migrate', '--db', `sqlite:${db}`)).stdout).toBe('Already up to date (0001_init)\n')
    const seed = await cli('seed', '--db', db, '--days', '2', '--seed', '5')
    expect(seed.code).toBe(0)
    expect(seed.stdout).toMatch(/Seeded site demo \(API key ak_demo0005\w+\)/)
    const doctor = await cli('doctor', '--db', db, '--url', healthUrl)
    expect(doctor.code).toBe(0)
    expect(doctor.stdout).toContain('✓ Bun')
    expect(doctor.stdout).toContain('✓ database reachable (sqlite)')
    expect(doctor.stdout).toContain('✓ schema up to date (0001_init)')
    expect(doctor.stdout).toContain(`✓ ${healthUrl}/api/health answered 200`)

    const storage = sqliteStorage(db)
    const [row] = await storage.query<{ n: number }>('SELECT COUNT(*) AS n FROM sessions')
    expect(row?.n).toBeGreaterThan(0)
    await storage.close?.()
  })

  it('prints the schema SQL for wrangler and points D1 migrations to it', async () => {
    const printed = await cli('migrate', '--print-sql', 'sqlite')
    expect(printed.code).toBe(0)
    const db = new DatabaseSync(':memory:')
    db.exec(printed.stdout)
    expect(db.prepare('SELECT version FROM schema_migrations').all()).toEqual([{ version: '0001_init' }])
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'payments'").all()).toHaveLength(1)
    db.close()
    expect((await cli('migrate', '--print-sql', 'postgres')).stdout).toContain('-- 0001_init')
    expect((await cli('migrate', '--print-sql', 'mysql')).code).toBe(2)
    const d1 = await cli('migrate', '--d1', 'analytik-db')
    expect(d1.code).toBe(1)
    expect(d1.stderr).toContain('wrangler d1 execute analytik-db --remote --file analytik-schema.sql')
  })

  it('reports failures from doctor with exit code 1', async () => {
    const failed = await cli('doctor', '--db', 'mysql://nope', '--url', `${healthUrl}/other/health`)
    expect(failed.code).toBe(1)
    expect(failed.stdout).toContain('✗ database: Unsupported database "mysql://nope"')
    expect(failed.stdout).toContain('/other/health answered 503')
    const unreachable = await cli('doctor', '--url', 'http://127.0.0.1:1')
    expect(unreachable.code).toBe(1)
    expect(unreachable.stdout).toContain('✗ http://127.0.0.1:1/api/health')
  })
})
