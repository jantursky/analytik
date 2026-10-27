import type { Migration } from '../types'
import { init } from './0001_init'

/** Postgres (Supabase, Neon or self-hosted), applied in order and recorded in `schema_migrations`. */
export const migrations: readonly Migration[] = [
  { version: '0001_init', sql: init({ big: 'BIGINT', real: 'DOUBLE PRECISION' }) },
]
