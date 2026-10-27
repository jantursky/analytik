import { applyMigrations } from './migrator'
import { migrations } from './migrations/sqlite'
import { normalizeParams } from './sql/statements'
import type { Statement, Storage } from './types'

export type { Dialect, Migration, MigrationResult, Statement, Storage } from './types'

/** The parts of a Cloudflare `D1Database` binding the storage uses; a real binding satisfies it. */
export interface D1Like {
  prepare(sql: string): D1StatementLike
  batch(statements: D1StatementLike[]): Promise<unknown>
}

export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike
  all(): Promise<{ results: unknown[] }>
  run(): Promise<{ meta: { changes: number } }>
}

/** Storage on a Cloudflare D1 binding (`env.DB`). D1 speaks the SQLite dialect. */
export function d1Storage(d1: D1Like): Storage {
  const prepare = ({ sql, params }: Statement) => d1.prepare(sql).bind(...normalizeParams(params))

  const storage: Storage = {
    dialect: 'sqlite',
    migrate: () => applyMigrations(storage, migrations),
    async query<T>(sql: string, params?: unknown[]) {
      return (await prepare({ sql, params }).all()).results as T[]
    },
    async run(sql, params) {
      return { changes: (await prepare({ sql, params }).run()).meta.changes }
    },
    async batch(statements) {
      // D1 runs a batch as one transaction.
      if (statements.length > 0) await d1.batch(statements.map(prepare))
    },
  }
  return storage
}
