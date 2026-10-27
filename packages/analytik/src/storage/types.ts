export type Dialect = 'sqlite' | 'postgres' | 'memory'

/** One SQL statement with `?` placeholders. Adapters translate placeholders for their driver. */
export interface Statement {
  sql: string
  params?: unknown[]
}

export interface Migration {
  /** Sortable name, e.g. `0001_init`. */
  version: string
  sql: string
}

export interface MigrationResult {
  /** Versions applied by this call, in order. */
  applied: string[]
  /** The latest version now in the database. */
  version: string | null
}

export interface Storage {
  readonly dialect: Dialect
  /** Applies pending migrations. Safe to call on every start. */
  migrate(): Promise<MigrationResult>
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>
  /** Runs the statements in one transaction where the driver allows it. */
  batch(statements: Statement[]): Promise<void>
  close?(): Promise<void>
}
