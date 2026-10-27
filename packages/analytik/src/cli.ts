import { parseArgs } from 'node:util'

import pkg from '../package.json'
import { openStorage, seedDemo } from './migrate'
import { migrations as postgresMigrations } from './storage/migrations/postgres'
import { migrations } from './storage/migrations/sqlite'
import type { Storage } from './storage/types'

const USAGE = `Usage: analytik <command> [options]

Commands:
  init [--target worker|vercel|bun|node]   Print a server entry file to start from
  migrate --db <url>                       Create or update the database schema
  migrate --print-sql sqlite|postgres      Print the schema SQL (for wrangler d1 execute --file)
  seed --db <url> [--days 30] [--seed 1]   Fill a database with demo data
  doctor [--db <url>] [--url <deployment>] Check the runtime, database and a deployment

Databases: postgres://user:pass@host/db, sqlite:<path>, a .db file path or :memory:

Options:
  -h, --help       Show this help
  -v, --version    Show the version`

const SAMPLES: Record<string, string> = {
  worker: `// src/index.ts: a Cloudflare Worker with a D1 binding named DB
import { createAnalytik, type Analytik } from 'analytik/server'
import { d1Storage } from 'analytik/storage/d1'

interface Env {
  DB: D1Database
  ADMIN_PASSWORD: string
  SESSION_SECRET: string
}

let analytik: Analytik | undefined

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    analytik ??= createAnalytik({
      storage: d1Storage(env.DB),
      admin: { password: env.ADMIN_PASSWORD, secret: env.SESSION_SECRET },
    })
    return analytik.app.fetch(request, env, ctx)
  },
}
`,
  vercel: `// app/api/[...path]/route.ts: a Next.js route on Vercel with Postgres (Supabase, Neon)
import postgres from 'postgres'
import { createAnalytik } from 'analytik/server'
import { postgresStorage } from 'analytik/storage/postgres'

const { app } = createAnalytik({
  storage: postgresStorage(postgres(process.env.DATABASE_URL ?? '')),
  admin: { password: process.env.ADMIN_PASSWORD!, secret: process.env.SESSION_SECRET! },
})

export const GET = app.fetch
export const POST = app.fetch
export const PATCH = app.fetch
export const DELETE = app.fetch
export const OPTIONS = app.fetch
`,
  bun: `// server.ts: run with \`bun server.ts\`
import { createAnalytik } from 'analytik/server'
import { sqliteStorage } from 'analytik/storage/sqlite'

const { app } = createAnalytik({
  storage: sqliteStorage('analytik.db'),
  admin: { password: Bun.env.ADMIN_PASSWORD!, secret: Bun.env.SESSION_SECRET! },
})

export default { port: 3000, fetch: app.fetch }
`,
  node: `// server.ts: needs \`npm install @hono/node-server\`
import { serve } from '@hono/node-server'
import { createAnalytik } from 'analytik/server'
import { sqliteStorage } from 'analytik/storage/sqlite'

const { app } = createAnalytik({
  storage: sqliteStorage('analytik.db'),
  admin: { password: process.env.ADMIN_PASSWORD!, secret: process.env.SESSION_SECRET! },
})

serve({ fetch: app.fetch, port: 3000 })
`,
}

const ADMIN_NOTE = `Set ADMIN_PASSWORD and SESSION_SECRET (32+ random characters, e.g. openssl rand -hex 32);
createAnalytik() refuses to start without them.`

const D1_MIGRATE = (name: string) => `D1 can't be reached from the command line. Load the schema with wrangler:
  analytik migrate --print-sql sqlite > analytik-schema.sql
  wrangler d1 execute ${name} --remote --file analytik-schema.sql
Or skip this: createAnalytik() applies pending migrations on the first request (autoMigrate).`

class UsageError extends Error {}

function required(value: string | undefined, flag: string): string {
  if (!value) throw new UsageError(`Missing ${flag}`)
  return value
}

function count(value: string | undefined, flag: string, fallback: number): number {
  if (value === undefined) return fallback
  const number = Number(value)
  if (!Number.isInteger(number) || number < 0) throw new UsageError(`${flag} must be a whole number`)
  return number
}

/** Every migration of a dialect plus the bookkeeping rows, so `createAnalytik()` won't run them again. */
function schemaSql(dialect: string | undefined, now: number): string {
  const list = dialect === 'sqlite' ? migrations : dialect === 'postgres' ? postgresMigrations : null
  if (!list) throw new UsageError('--print-sql must be sqlite or postgres')
  const applied = list.map(
    ({ version }) =>
      `INSERT INTO schema_migrations (version, applied_at) VALUES ('${version}', ${now}) ON CONFLICT DO NOTHING;`,
  )
  return [
    ...list.map(({ version, sql }) => `-- ${version}\n${sql.trim()}\n`),
    'CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at BIGINT NOT NULL);',
    ...applied,
    '',
  ].join('\n')
}

async function withStorage<T>(url: string, run: (storage: Storage) => Promise<T>): Promise<T> {
  const storage = await openStorage(url)
  try {
    return await run(storage)
  } finally {
    await storage.close?.()
  }
}

async function doctor(db: string | undefined, url: string | undefined): Promise<boolean> {
  let ok = true
  const report = (passed: boolean, message: string) => {
    ok &&= passed
    console.log(`${passed ? '✓' : '✗'} ${message}`)
  }
  const bun = process.versions.bun
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number)
  if (bun) report(true, `Bun ${bun}`)
  else report(major > 22 || (major === 22 && minor >= 19), `Node ${process.versions.node} (22.19 or newer needed)`)

  if (db) {
    try {
      await withStorage(db, async (storage) => {
        await storage.query('SELECT 1 AS ok')
        report(true, `database reachable (${storage.dialect})`)
        const latest = migrations.at(-1)?.version
        const rows = await storage.query<{ version: string }>('SELECT version FROM schema_migrations').catch(() => [])
        const current = rows
          .map((row) => row.version)
          .sort()
          .at(-1)
        report(
          current === latest,
          current === latest ? `schema up to date (${current})` : 'schema not up to date: run analytik migrate',
        )
      })
    } catch (error) {
      report(false, `database: ${(error as Error).message}`)
    }
  }

  if (url) {
    const health = /\/health\/?$/.test(url) ? url : `${url.replace(/\/+$/, '')}/api/health`
    try {
      const response = await fetch(health)
      const body = (await response.json().catch(() => null)) as { ok?: boolean } | null
      report(response.ok && body?.ok === true, `${health} answered ${response.status}`)
    } catch (error) {
      report(false, `${health}: ${(error as Error).message}`)
    }
  }
  return ok
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      target: { type: 'string' },
      db: { type: 'string' },
      d1: { type: 'boolean' },
      'print-sql': { type: 'string' },
      days: { type: 'string' },
      seed: { type: 'string' },
      url: { type: 'string' },
    },
  })
  const [command] = positionals
  if (values.version) {
    console.log(pkg.version)
    return 0
  }
  if (values.help || !command) {
    console.log(USAGE)
    return 0
  }

  switch (command) {
    case 'init': {
      const sample = SAMPLES[values.target ?? 'worker']
      if (!sample) throw new UsageError(`--target must be one of ${Object.keys(SAMPLES).join(', ')}`)
      process.stdout.write(sample)
      // stderr, so the sample can be piped into a file.
      console.error(ADMIN_NOTE)
      return 0
    }
    case 'migrate': {
      if (values['print-sql'] !== undefined) {
        process.stdout.write(schemaSql(values['print-sql'], Date.now()))
        return 0
      }
      if (values.d1) {
        // `--d1` is a flag, so the database name lands in the positionals.
        console.error(D1_MIGRATE(positionals[1] ?? '<database>'))
        return 1
      }
      const result = await withStorage(required(values.db, '--db'), (storage) => storage.migrate())
      console.log(
        result.applied.length > 0
          ? `Applied ${result.applied.join(', ')}`
          : `Already up to date (${result.version ?? '-'})`,
      )
      return 0
    }
    case 'seed': {
      const days = count(values.days, '--days', 30)
      const seed = count(values.seed, '--seed', 1)
      const result = await withStorage(required(values.db, '--db'), (storage) => seedDemo(storage, { days, seed }))
      console.log(`Seeded site ${result.siteId} (API key ${result.apiKey})`)
      for (const [table, rows] of Object.entries(result.counts)) console.log(`  ${table}: ${rows}`)
      return 0
    }
    case 'doctor':
      return (await doctor(values.db, values.url)) ? 0 : 1
    default:
      throw new UsageError(`Unknown command "${command}"`)
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    const usage = error instanceof UsageError || (error as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')
    console.error(`analytik: ${(error as Error).message}${usage ? '\nRun analytik --help for usage.' : ''}`)
    process.exitCode = usage ? 2 : 1
  },
)
