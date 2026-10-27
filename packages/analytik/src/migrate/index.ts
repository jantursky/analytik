import { type PostgresJsSql, postgresStorage } from '../storage/postgres'
import { sqliteStorage } from '../storage/sqlite'
import type { Storage } from '../storage/types'

export { seedDemo, type SeedOptions, type SeedResult } from './seed'
export type { Storage } from '../storage/types'

// A variable keeps bundlers from resolving the optional peer dependency at build time.
const POSTGRES = 'postgres'

/**
 * Opens a storage from a connection string, for scripts and the CLI: `postgres://...` (needs the `postgres`
 * package), or a SQLite file as `sqlite:<path>`, `file:<path>`, `:memory:` or a path ending in .db/.sqlite/.sqlite3.
 */
export async function openStorage(url: string): Promise<Storage> {
  if (/^postgres(ql)?:\/\//i.test(url)) {
    const { default: postgres } = (await import(/* @vite-ignore */ POSTGRES)) as {
      default: (url: string, options: { max: number; onnotice: () => void }) => PostgresJsSql
    }
    return postgresStorage(postgres(url, { max: 4, onnotice: () => undefined }))
  }
  const file = /^(sqlite|file):(\/\/)?(.+)$/i.exec(url)?.[3]
  if (file) return sqliteStorage(file)
  if (url === ':memory:' || /\.(db|sqlite3?)$/i.test(url)) return sqliteStorage(url)
  throw new Error(`Unsupported database "${url}". Use postgres://..., sqlite:<path> or a .db file path.`)
}
