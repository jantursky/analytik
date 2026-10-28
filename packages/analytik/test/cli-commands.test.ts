import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { type Server, createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { sqliteStorage } from '../src/storage/sqlite'
import { openSqlite } from '../src/storage/sqlite-driver'

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
    expect(help.stdout).toContain('import --from umami|simple-analytics')
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
    expect(migrate).toMatchObject({ code: 0, stdout: 'Applied 0001_init, 0002_imported\n' })
    expect((await cli('migrate', '--db', `sqlite:${db}`)).stdout).toBe('Already up to date (0002_imported)\n')
    const seed = await cli('seed', '--db', db, '--days', '2', '--seed', '5')
    expect(seed.code).toBe(0)
    expect(seed.stdout).toMatch(/Seeded site demo \(API key ak_demo0005\w+\)/)
    const doctor = await cli('doctor', '--db', db, '--url', healthUrl)
    expect(doctor.code).toBe(0)
    expect(doctor.stdout).toContain('✓ Bun')
    expect(doctor.stdout).toContain('✓ database reachable (sqlite)')
    expect(doctor.stdout).toContain('✓ schema up to date (0002_imported)')
    expect(doctor.stdout).toContain(`✓ ${healthUrl}/api/health answered 200`)

    const storage = sqliteStorage(db)
    const [row] = await storage.query<{ n: number }>('SELECT COUNT(*) AS n FROM sessions')
    expect(row?.n).toBeGreaterThan(0)
    await storage.close?.()
  })

  describe('import', () => {
    const fixtures = join(packageDir, 'test/fixtures/import')
    const umami = ['umami-events.csv', 'umami-sessions.csv', 'umami-event-data.csv'].flatMap((name) => [
      '--file',
      join(fixtures, name),
    ])

    const seeded = async () => {
      const db = temp('import.db')
      expect((await cli('seed', '--db', db, '--days', '1', '--seed', '3')).code).toBe(0)
      return db
    }
    const imported = async (db: string) => {
      const storage = sqliteStorage(db)
      const [row] = await storage.query<{ n: number }>('SELECT COUNT(*) AS n FROM sessions WHERE imported IS NOT NULL')
      await storage.close?.()
      return row?.n
    }

    it('imports Umami files, tells the files apart by their columns and recognises a repeat', async () => {
      const db = await seeded()
      const first = await cli('import', '--from', 'umami', ...umami, '--site', 'demo', '--db', db)
      expect(first.code).toBe(0)
      expect(first.stdout).toContain('Imported 3 visits and 5 events from umami into demo')
      expect(first.stdout).toContain('skipped rows: 4')
      expect(first.stdout).toContain('events row 6: created_at is missing or not a date')
      expect(await imported(db)).toBe(3)

      const again = await cli('import', '--from', 'umami', ...umami, '--site', 'demo', '--db', db)
      expect(again.stdout).toContain('Imported 0 visits and 0 events')
      expect(again.stdout).toContain('already there: 3 visits, 5 events')
      expect(await imported(db)).toBe(3)
    })

    it('imports a Simple Analytics file', async () => {
      const db = await seeded()
      const run = await cli(
        'import',
        ...['--from', 'simple-analytics', '--file', join(fixtures, 'simple-analytics.csv')],
        ...['--site', 'demo', '--db', db],
      )
      expect(run.stdout).toContain('Imported 3 visits and 5 events from simple-analytics into demo')
      expect(run.stdout).toContain('export row 6: made by a robot')
    })

    it('stores nothing and names the problem for a wrong file, a missing column or an unknown site', async () => {
      const db = await seeded()
      const events = join(fixtures, 'umami-events.csv')
      const wrong = await cli(
        'import',
        '--from',
        'umami',
        '--file',
        join(fixtures, 'simple-analytics.csv'),
        '--site',
        'demo',
        '--db',
        db,
      )
      expect(wrong).toMatchObject({ code: 1 })
      expect(wrong.stderr).toContain('is not an Umami export')

      const noEvents = await cli(
        'import',
        '--from',
        'umami',
        '--file',
        join(fixtures, 'umami-sessions.csv'),
        '--site',
        'demo',
        '--db',
        db,
      )
      expect(noEvents.stderr).toContain('no Umami events found')

      const lacking = temp('events.csv')
      writeFileSync(lacking, 'event_type,url_path\n1,/\n')
      const missing = await cli('import', '--from', 'umami', '--file', lacking, '--site', 'demo', '--db', db)
      expect(missing.stderr).toContain('lacks the column created_at, session_id')

      const site = await cli('import', '--from', 'umami', '--file', events, '--site', 'nope', '--db', db)
      expect(site.code).toBe(1)
      expect(site.stderr).toContain('site not found')
      expect(await imported(db)).toBe(0)
    })

    it('rejects bad arguments with exit code 2', async () => {
      expect((await cli('import', '--from', 'matomo', '--file', 'x', '--site', 's', '--db', ':memory:')).code).toBe(2)
      expect((await cli('import', '--from', 'umami', '--site', 's', '--db', ':memory:')).stderr).toContain(
        'Missing --file',
      )
      expect((await cli('import', '--file', 'x', '--site', 's', '--db', ':memory:')).stderr).toContain('Missing --from')
      expect((await cli('import', '--from', 'umami', '--file', 'x', '--db', ':memory:')).stderr).toContain(
        'Missing --site',
      )
    })
  })

  it('prints the schema SQL for wrangler and points D1 migrations to it', async () => {
    const printed = await cli('migrate', '--print-sql', 'sqlite')
    expect(printed.code).toBe(0)
    const db = await openSqlite(':memory:')
    db.exec(printed.stdout)
    expect(db.all('SELECT version FROM schema_migrations', [])).toEqual([
      { version: '0001_init' },
      { version: '0002_imported' },
    ])
    expect(db.all("SELECT name FROM sqlite_master WHERE name = 'payments'", [])).toHaveLength(1)
    db.close()
    const postgres = (await cli('migrate', '--print-sql', 'postgres')).stdout
    expect(postgres).toContain('-- 0001_init')
    expect(postgres).toContain('-- 0002_imported')
    expect(postgres).toContain('ALTER TABLE sessions ADD COLUMN imported TEXT')
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
