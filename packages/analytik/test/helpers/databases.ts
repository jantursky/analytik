// Real databases for the suites: in-memory SQLite, a SQLite file, D1 (over the runtime's SQLite) and Postgres.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import pg from 'pg'
import postgres from 'postgres'
import { inject } from 'vitest'

import { type D1Like, type D1StatementLike, d1Storage } from '../../src/storage/d1'
import { memoryStorage } from '../../src/storage/memory'
import { postgresStorage } from '../../src/storage/postgres'
import { sqliteStorage } from '../../src/storage/sqlite'
import { type SqliteConnection, openSqlite } from '../../src/storage/sqlite-driver'
import type { Storage } from '../../src/storage/types'

/**
 * A D1 binding backed by the runtime's SQLite (`bun:sqlite` on Bun, `node:sqlite` on Node), with D1's
 * batch-as-transaction semantics.
 */
export function fakeD1(connection: Promise<SqliteConnection> = openSqlite(':memory:')): D1Like {
  const statement = (sql: string, values: unknown[] = []): D1StatementLike => ({
    bind: (...next) => statement(sql, next),
    all: async () => ({ results: (await connection).all(sql, values) }),
    run: async () => ({ meta: { changes: (await connection).run(sql, values) } }),
  })
  return {
    prepare: (sql) => statement(sql),
    async batch(statements) {
      const db = await connection
      db.exec('BEGIN')
      try {
        for (const item of statements) await item.run()
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      return []
    },
  }
}

export const postgresUrl = (): string | null => inject('postgres')

let databaseCounter = 0

/** Connection options for a URL; the local test cluster listens on a socket directory given as `?host=`. */
export function postgresOptions(url: string): {
  host: string
  port: number
  user: string
  password?: string
  database: string
} {
  const parsed = new URL(url)
  return {
    host: parsed.searchParams.get('host') ?? parsed.hostname,
    port: Number(parsed.port || 5432),
    user: decodeURIComponent(parsed.username || 'postgres'),
    // A local cluster often trusts local connections; CI's service container wants the password.
    ...(parsed.password && { password: decodeURIComponent(parsed.password) }),
    database: parsed.pathname.slice(1) || 'postgres',
  }
}

/** A fresh, empty Postgres database on the test cluster. */
async function freshPostgresUrl(): Promise<string> {
  const base = postgresUrl()!
  const name = `analytik_${process.pid}_${Date.now()}_${++databaseCounter}`
  const admin = postgres({ ...postgresOptions(base), max: 1, onnotice: () => {} })
  await admin.unsafe(`CREATE DATABASE ${name}`)
  await admin.end()
  const url = new URL(base)
  url.pathname = `/${name}`
  return url.toString()
}

export type StorageKind = 'memory' | 'sqlite' | 'd1' | 'postgres' | 'pg'

export async function createStorage(kind: StorageKind): Promise<Storage> {
  switch (kind) {
    case 'memory':
      return memoryStorage()
    case 'sqlite':
      return sqliteStorage(join(mkdtempSync(join(tmpdir(), 'analytik-sqlite-')), 'test.db'))
    case 'd1':
      return d1Storage(fakeD1())
    case 'postgres':
      return postgresStorage(postgres({ ...postgresOptions(await freshPostgresUrl()), max: 4, onnotice: () => {} }))
    case 'pg':
      return postgresStorage(new pg.Pool({ ...postgresOptions(await freshPostgresUrl()), max: 4 }))
  }
}

/** Every kind available in this environment; Postgres only when a server could be started. */
export function storageKinds(): StorageKind[] {
  return postgresUrl() ? ['memory', 'sqlite', 'd1', 'postgres', 'pg'] : ['memory', 'sqlite', 'd1']
}
