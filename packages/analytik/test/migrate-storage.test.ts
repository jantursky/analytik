import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { openStorage } from '../src/migrate'

describe('openStorage', () => {
  it('opens SQLite from every supported spelling', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'analytik-open-'))
    for (const url of [`sqlite:${join(dir, 'a.db')}`, `file://${join(dir, 'b')}`, join(dir, 'c.sqlite3'), ':memory:']) {
      const storage = await openStorage(url)
      expect(storage.dialect).toBe('sqlite')
      await expect(storage.migrate()).resolves.toMatchObject({ version: '0003_ignore_admins' })
      await storage.close?.()
    }
  })

  it('opens Postgres lazily through the postgres package', async () => {
    const storage = await openStorage('postgresql://nobody@127.0.0.1:1/none')
    expect(storage.dialect).toBe('postgres')
    await storage.close?.()
  })

  it('rejects anything else', async () => {
    await expect(openStorage('mysql://localhost/db')).rejects.toThrow('Unsupported database "mysql://localhost/db"')
  })
})
