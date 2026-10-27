import { applyMigrations } from './migrator'
import { migrations } from './migrations/sqlite'
import { normalizeParams } from './sql/statements'
import type { Dialect, Storage } from './types'

/** The part of a synchronous SQLite driver the storage needs. */
export interface SqliteConnection {
  all(sql: string, params: unknown[]): unknown[]
  run(sql: string, params: unknown[]): number
  exec(sql: string): void
  close(): void
}

interface Prepared {
  all(...params: unknown[]): unknown[]
  run(...params: unknown[]): { changes: number | bigint }
}

interface Driver {
  prepare(sql: string): Prepared
  exec(sql: string): void
  close(): void
}

function wrap(db: Driver): SqliteConnection {
  const cache = new Map<string, Prepared>()
  const prepare = (sql: string) => {
    let statement = cache.get(sql)
    if (!statement) {
      statement = db.prepare(sql)
      cache.set(sql, statement)
    }
    return statement
  }
  return {
    all: (sql, params) => prepare(sql).all(...params),
    run: (sql, params) => Number(prepare(sql).run(...params).changes),
    exec: (sql) => db.exec(sql),
    close: () => db.close(),
  }
}

// Variables keep bundlers from resolving these at build time; only the one for the current runtime loads.
const BUN_SQLITE = 'bun:sqlite'
const NODE_SQLITE = 'node:sqlite'

/** Opens a database with `bun:sqlite` on Bun and `node:sqlite` on Node. */
export async function openSqlite(filename: string): Promise<SqliteConnection> {
  let db: Driver
  if ('Bun' in globalThis) {
    const { Database } = (await import(/* @vite-ignore */ BUN_SQLITE)) as {
      Database: new (filename: string, options: { create: boolean }) => Driver
    }
    db = new Database(filename, { create: true })
  } else {
    const { DatabaseSync } = (await import(/* @vite-ignore */ NODE_SQLITE)) as {
      DatabaseSync: new (filename: string) => Driver
    }
    db = new DatabaseSync(filename)
  }
  db.exec('PRAGMA busy_timeout = 5000')
  if (filename !== ':memory:') db.exec('PRAGMA journal_mode = WAL')
  return wrap(db)
}

/** A Storage over a synchronous SQLite connection that opens on first use. */
export function connectionStorage(open: () => Promise<SqliteConnection>, dialect: Dialect): Storage {
  let connection: Promise<SqliteConnection> | undefined
  const db = () => (connection ??= open())

  const storage: Storage = {
    dialect,
    migrate: () => applyMigrations(storage, migrations),
    async query<T>(sql: string, params?: unknown[]) {
      return (await db()).all(sql, normalizeParams(params)) as T[]
    },
    async run(sql, params) {
      return { changes: (await db()).run(sql, normalizeParams(params)) }
    },
    async batch(statements) {
      const conn = await db()
      // The driver is synchronous, so nothing else can run between BEGIN and COMMIT.
      conn.exec('BEGIN')
      try {
        for (const statement of statements) conn.run(statement.sql, normalizeParams(statement.params))
        conn.exec('COMMIT')
      } catch (error) {
        conn.exec('ROLLBACK')
        throw error
      }
    },
    async close() {
      if (connection) (await connection).close()
      connection = undefined
    },
  }
  return storage
}
