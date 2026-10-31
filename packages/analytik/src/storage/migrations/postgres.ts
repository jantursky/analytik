import type { Migration } from '../types'
import { init } from './0001_init'
import { imported } from './0002_imported'
import { ignoreAdmins } from './0003_ignore_admins'

/** Postgres (Supabase, Neon or self-hosted), applied in order and recorded in `schema_migrations`. */
export const migrations: readonly Migration[] = [
  { version: '0001_init', sql: init({ big: 'BIGINT', real: 'DOUBLE PRECISION' }) },
  { version: '0002_imported', sql: imported() },
  { version: '0003_ignore_admins', sql: ignoreAdmins() },
]
