import type { Migration } from '../types'
import { init } from './0001_init'

/** SQLite and Cloudflare D1, applied in order and recorded in `schema_migrations`. */
export const migrations: readonly Migration[] = [{ version: '0001_init', sql: init({ big: 'INTEGER', real: 'REAL' }) }]
