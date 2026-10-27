import { connectionStorage, openSqlite } from './sqlite-driver'
import type { Storage } from './types'

export type { Dialect, Migration, MigrationResult, Statement, Storage } from './types'

/**
 * SQLite file storage for Bun and Node: `bun:sqlite` on Bun, `node:sqlite` on Node 22.13 and newer.
 * The database opens on first use.
 */
export function sqliteStorage(filename: string): Storage {
  return connectionStorage(() => openSqlite(filename), 'sqlite')
}
