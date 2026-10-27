import { connectionStorage, openSqlite } from './sqlite-driver'
import type { Storage } from './types'

export type { Dialect, Migration, MigrationResult, Statement, Storage } from './types'

/**
 * A throwaway in-process SQLite database, for tests and demos. It runs the same SQL as the other
 * storages, so what passes here passes on D1 and SQLite files.
 */
export function memoryStorage(): Storage {
  return connectionStorage(() => openSqlite(':memory:'), 'memory')
}
