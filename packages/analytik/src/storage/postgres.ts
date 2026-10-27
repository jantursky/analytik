import { applyMigrations } from './migrator'
import { migrations } from './migrations/postgres'
import { normalizeParams, toNumberedPlaceholders } from './sql/statements'
import type { Statement, Storage } from './types'

export type { Dialect, Migration, MigrationResult, Statement, Storage } from './types'

/** The parts of a `postgres` (porsager) `sql` instance or transaction the storage uses. */
export interface PostgresJsQueryable {
  unsafe(query: string, params?: unknown[]): PromiseLike<PostgresJsResult>
}

export interface PostgresJsSql extends PostgresJsQueryable {
  begin(fn: (sql: PostgresJsQueryable) => Promise<unknown>): Promise<unknown>
  end(): Promise<void>
}

export type PostgresJsResult = Record<string, unknown>[] & {
  count: number | null
  columns?: readonly { name: string; type: number }[]
}

/** The parts of a `pg` `Pool` or `Client` the storage uses. */
export interface PgQueryable {
  query(text: string, params?: unknown[]): Promise<PgResult>
  end(): Promise<void>
}

export interface PgPoolLike extends PgQueryable {
  connect(): Promise<PgQueryable & { release(): void }>
  totalCount: number
}

export interface PgResult {
  rows: Record<string, unknown>[]
  rowCount: number | null
  fields: readonly { name: string; dataTypeID: number }[]
}

// int8 and numeric arrive as strings (they can exceed 2^53); counts and sums here never do.
const NUMERIC_TYPES = new Set([20, 1700])

function numericColumns(fields: readonly { name: string; type: number }[] | undefined): string[] {
  return (fields ?? []).filter((field) => NUMERIC_TYPES.has(field.type)).map((field) => field.name)
}

function toNumbers<T>(rows: Record<string, unknown>[], columns: string[]): T[] {
  if (columns.length > 0) {
    for (const row of rows) {
      for (const column of columns) if (typeof row[column] === 'string') row[column] = Number(row[column])
    }
  }
  return rows as T[]
}

interface Executor {
  query<T>(statement: Statement): Promise<T[]>
  run(statement: Statement): Promise<number>
}

function postgresJsExecutor(sql: PostgresJsQueryable): Executor {
  const execute = (statement: Statement) =>
    sql.unsafe(toNumberedPlaceholders(statement.sql), normalizeParams(statement.params))
  return {
    async query<T>(statement: Statement) {
      const result = await execute(statement)
      return toNumbers<T>([...result], numericColumns(result.columns))
    },
    async run(statement) {
      return (await execute(statement)).count ?? 0
    },
  }
}

function pgExecutor(client: PgQueryable): Executor {
  const execute = (statement: Statement) =>
    client.query(toNumberedPlaceholders(statement.sql), normalizeParams(statement.params))
  return {
    async query<T>(statement: Statement) {
      const result = await execute(statement)
      const fields = result.fields.map((field) => ({ name: field.name, type: field.dataTypeID }))
      return toNumbers<T>(result.rows, numericColumns(fields))
    },
    async run(statement) {
      return (await execute(statement)).rowCount ?? 0
    },
  }
}

function isPostgresJs(client: PostgresJsSql | PgQueryable): client is PostgresJsSql {
  return typeof (client as Partial<PostgresJsSql>).unsafe === 'function'
}

async function pgTransaction(client: PgQueryable, statements: Statement[]): Promise<void> {
  const isPool = 'totalCount' in client && typeof (client as Partial<PgPoolLike>).connect === 'function'
  const conn = isPool ? await (client as PgPoolLike).connect() : client
  const executor = pgExecutor(conn)
  try {
    await conn.query('BEGIN')
    try {
      for (const statement of statements) await executor.run(statement)
      await conn.query('COMMIT')
    } catch (error) {
      await conn.query('ROLLBACK')
      throw error
    }
  } finally {
    if (isPool) (conn as PgQueryable & { release(): void }).release()
  }
}

/**
 * Storage on Postgres (Supabase, Neon, plain Postgres). Pass a `postgres` (porsager) `sql` instance
 * or a `pg` `Pool`/`Client`; the storage doesn't open or configure connections itself.
 */
export function postgresStorage(client: PostgresJsSql | PgQueryable): Storage {
  const executor = isPostgresJs(client) ? postgresJsExecutor(client) : pgExecutor(client)

  const storage: Storage = {
    dialect: 'postgres',
    migrate: () => applyMigrations(storage, migrations),
    query: <T>(sql: string, params?: unknown[]) => executor.query<T>({ sql, params }),
    async run(sql, params) {
      return { changes: await executor.run({ sql, params }) }
    },
    async batch(statements) {
      if (statements.length === 0) return
      if (isPostgresJs(client)) {
        await client.begin(async (tx) => {
          const transaction = postgresJsExecutor(tx)
          for (const statement of statements) await transaction.run(statement)
        })
      } else {
        await pgTransaction(client, statements)
      }
    },
    close: () => client.end(),
  }
  return storage
}
