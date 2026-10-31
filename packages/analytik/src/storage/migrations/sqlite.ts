import type { Migration } from '../types'
import { init } from './0001_init'
import { imported } from './0002_imported'
import { ignoreAdmins } from './0003_ignore_admins'

/** SQLite and Cloudflare D1, applied in order and recorded in `schema_migrations`. */
export const migrations: readonly Migration[] = [
  { version: '0001_init', sql: init({ big: 'INTEGER', real: 'REAL' }) },
  { version: '0002_imported', sql: imported() },
  { version: '0003_ignore_admins', sql: ignoreAdmins() },
]
