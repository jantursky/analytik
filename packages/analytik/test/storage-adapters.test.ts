import { afterEach, describe, expect, it } from 'vitest'

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
    expect(first.applied).toEqual(['0001_init'])
    expect(first.version).toBe('0001_init')
    const second = await storage.migrate()
    expect(second.applied).toEqual([])
    const rows = await storage.query<{ version: string }>('SELECT version FROM schema_migrations')
    expect(rows.map((row) => row.version)).toEqual(['0001_init'])
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
