import { splitStatements } from './sql/statements'
import type { Migration, MigrationResult, Storage } from './types'

/** Applies the migrations not yet recorded in `schema_migrations`, each in its own transaction. */
export async function applyMigrations(
  storage: Pick<Storage, 'query' | 'run' | 'batch'>,
  migrations: readonly Migration[],
): Promise<MigrationResult> {
  let rows: { version: string }[]
  try {
    rows = await storage.query<{ version: string }>('SELECT version FROM schema_migrations')
  } catch {
    // First run. Creating only when missing keeps Postgres from logging an "already exists" notice on every start.
    await storage.run(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at BIGINT NOT NULL)',
    )
    rows = []
  }
  const done = new Set(rows.map((row) => row.version))
  const applied: string[] = []
  for (const migration of migrations) {
    if (done.has(migration.version)) continue
    await storage.batch([
      ...splitStatements(migration.sql).map((sql) => ({ sql })),
      {
        sql: 'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?) ON CONFLICT DO NOTHING',
        params: [migration.version, Date.now()],
      },
    ])
    applied.push(migration.version)
  }
  return { applied, version: migrations.at(-1)?.version ?? null }
}
