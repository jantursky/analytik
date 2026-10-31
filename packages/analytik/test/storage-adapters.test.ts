import { afterEach, describe, expect, it } from 'vitest'

import { applyMigrations } from '../src/storage/migrator'
import { memoryStorage } from '../src/storage/memory'
import { migrations } from '../src/storage/migrations/sqlite'
import type { Storage } from '../src/storage/types'
import { createStorage, storageKinds } from './helpers/databases'

describe.each(storageKinds())('%s storage', (kind) => {
  let storage: Storage

  afterEach(async () => {
    await storage.close?.()
  })

  it('applies migrations once and records them', async () => {
    storage = await createStorage(kind)
    const first = await storage.migrate()
    expect(first.applied).toEqual(['0001_init', '0002_imported', '0003_ignore_admins'])
    expect(first.version).toBe('0003_ignore_admins')
    const second = await storage.migrate()
    expect(second.applied).toEqual([])
    const rows = await storage.query<{ version: string }>('SELECT version FROM schema_migrations')
    expect(rows.map((row) => row.version)).toEqual(['0001_init', '0002_imported', '0003_ignore_admins'])
  })

  it('runs parameterized statements and returns numbers for counts and sums', async () => {
    storage = await createStorage(kind)
    await storage.migrate()
    const insert = 'INSERT INTO salts (month, value, created_at) VALUES (?, ?, ?)'
    expect(await storage.run(insert, ['2026-01', 'a?b', 1_700_000_000_000])).toEqual({ changes: 1 })
    await storage.run(insert, ['2026-02', "it's", 1_700_000_000_001])
    const rows = await storage.query<{ n: number; total: number; question: string }>(
      "SELECT COUNT(*) AS n, SUM(created_at) AS total, MAX(CASE WHEN value = 'a?b' THEN value END) AS question FROM salts WHERE month >= ?",
      ['2026'],
    )
    expect(rows).toEqual([{ n: 2, total: 3_400_000_000_001, question: 'a?b' }])
    expect(await storage.run('DELETE FROM salts WHERE month = ?', ['2026-01'])).toEqual({ changes: 1 })
  })

  it('converts booleans and undefined parameters', async () => {
    storage = await createStorage(kind)
    await storage.migrate()
    await storage.run('INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, ?)', ['k', true, 1])
    await storage.run('UPDATE rate_limits SET window_start = ? WHERE key = ?', [false, 'k'])
    await expect(storage.query('SELECT window_start FROM rate_limits WHERE key = ?', ['k'])).resolves.toEqual([
      { window_start: 0 },
    ])
    await storage.run('INSERT INTO visitors (site_id, id, first_seen, email) VALUES (?, ?, ?, ?)', [
      's',
      'v',
      1,
      undefined,
    ])
    await expect(storage.query('SELECT email FROM visitors')).resolves.toEqual([{ email: null }])
  })

  it('commits a batch atomically and rolls back on failure', async () => {
    storage = await createStorage(kind)
    await storage.migrate()
    const insert = 'INSERT INTO salts (month, value, created_at) VALUES (?, ?, ?)'
    await storage.batch([
      { sql: insert, params: ['2026-01', 'a', 1] },
      { sql: insert, params: ['2026-02', 'b', 2] },
    ])
    await expect(
      storage.batch([
        { sql: insert, params: ['2026-03', 'c', 3] },
        { sql: insert, params: ['2026-01', 'duplicate', 4] },
      ]),
    ).rejects.toThrow()
    const rows = await storage.query<{ month: string }>('SELECT month FROM salts ORDER BY month')
    expect(rows.map((row) => row.month)).toEqual(['2026-01', '2026-02'])
    await storage.batch([])
  })
})

describe('0002_imported', () => {
  it('upgrades a database that already holds data and leaves tracked rows unmarked', async () => {
    const storage = memoryStorage()
    await applyMigrations(storage, migrations.slice(0, 1))
    await storage.run(
      `INSERT INTO sessions (site_id, id, visitor_id, started_at, last_seen_at, source, channel)
       VALUES ('s', 'a', 'v', 1, 1, 'direct', 'direct')`,
    )
    await storage.run(
      `INSERT INTO events (id, site_id, session_id, visitor_id, ts, type) VALUES ('e', 's', 'a', 'v', 1, 'pageview')`,
    )

    const result = await applyMigrations(storage, migrations)
    expect(result.applied).toEqual(['0002_imported', '0003_ignore_admins'])
    expect(await storage.query('SELECT id, imported FROM sessions')).toEqual([{ id: 'a', imported: null }])
    expect(await storage.query('SELECT id, imported FROM events')).toEqual([{ id: 'e', imported: null }])
    await storage.close?.()
  })
})

describe('0003_ignore_admins', () => {
  it('leaves existing sites with the switch off', async () => {
    const storage = memoryStorage()
    await applyMigrations(storage, migrations.slice(0, 2))
    await storage.run(
      `INSERT INTO sites (id, name, domain, api_key_hash, created_at) VALUES ('s', 'S', 's.com', 'x', 1)`,
    )
    await applyMigrations(storage, migrations)
    expect(await storage.query('SELECT ignore_admins FROM sites')).toEqual([{ ignore_admins: 0 }])
    await storage.close?.()
  })
})
