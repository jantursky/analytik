import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { parseCsv } from '../src/shared/import/csv'
import { chunkVisits, prepareImport } from '../src/shared/import/prepare'
import type { ImportResult, ImportSource } from '../src/shared/import/types'
import type { BreakdownRow, Overview, Page, SessionSummary } from '../src/shared/types'
import { storageKinds } from './helpers/databases'
import { type TestServer, testServer } from './helpers/server'

const read = (name: string) => ({
  name,
  parts: { rows: parseCsv(readFileSync(join(import.meta.dirname, 'fixtures/import', name), 'utf8')) },
})
const umami = () => prepareImport('umami', ['umami-events.csv', 'umami-sessions.csv', 'umami-event-data.csv'].map(read))
const simpleAnalytics = () => prepareImport('simple-analytics', [read('simple-analytics.csv')])

const RANGE = 'from=2026-03-01&to=2026-03-16'

describe.each(storageKinds())('importing history on %s', (kind) => {
  let server: TestServer

  afterEach(async () => {
    await server.storage.close?.()
  })

  it('adds history next to tracked data, ignores a repeat and removes cleanly', async () => {
    server = await testServer(kind)
    const { site } = await server.createSite()
    const id = site.id

    // One tracked visit from Chrome, so imported and tracked rows have something to share a breakdown key with.
    await server.event({ w: id, t: 'pageview', u: 'https://example.com/tracked' })
    const overview = () => server.adminJson<Overview>(`/sites/${id}/overview?${RANGE}`)
    const sessions = () => server.adminJson<Page<SessionSummary>>(`/sites/${id}/sessions?${RANGE}&limit=50`)
    const browsers = async () =>
      Object.fromEntries(
        (await server.adminJson<BreakdownRow[]>(`/sites/${id}/breakdown?${RANGE}&dimension=browser`)).map((row) => [
          row.key,
          row.visitors,
        ]),
      )
    const importAll = async (source: ImportSource, visits: ReturnType<typeof umami>['visits']) => {
      const results: ImportResult[] = []
      for (const chunk of chunkVisits(visits)) {
        results.push(
          await server.adminJson<ImportResult>(`/sites/${id}/import`, {
            method: 'POST',
            json: { source, visits: chunk },
          }),
        )
      }
      return results
    }

    const before = await overview()
    expect(before.sessions.value).toBe(1)
    expect(await browsers()).toEqual({ Chrome: 1 })

    // Umami (3 visits) and Simple Analytics (3 visits).
    const [first] = await importAll('umami', umami().visits)
    expect(first).toMatchObject({ visits: 3, events: 5 })
    await importAll('simple-analytics', simpleAnalytics().visits)

    const after = await overview()
    expect(after.sessions.value).toBe(7)
    expect(after.pageviews.value).toBeGreaterThan(before.pageviews.value)
    const list = await sessions()
    expect(list.total).toBe(7)
    expect(list.items.map((item) => item.entryPage)).toEqual(expect.arrayContaining(['/blog/hello', '/about', '/blog']))
    expect(list.items.find((item) => item.entryPage === '/tracked')).toBeDefined()
    // One Chrome row for three visitors: the tracked one, Umami's s1, and Simple Analytics' one fingerprint (two visits).
    expect((await browsers()).Chrome).toBe(3)

    const events = await server.adminJson<Page<{ type: string; name: string | null }>>(
      `/sites/${id}/events?${RANGE}&name=signup`,
    )
    expect(events.total).toBe(2)

    // Importing both again changes nothing.
    const [again] = await importAll('umami', umami().visits)
    await importAll('simple-analytics', simpleAnalytics().visits)
    expect(again).toMatchObject({ visits: 0, events: 0, existing: { visits: 3, events: 5 } })
    expect((await overview()).sessions.value).toBe(7)
    expect((await sessions()).total).toBe(7)

    // Removing the imports brings back the earlier totals.
    for (const source of ['umami', 'simple-analytics']) {
      await server.admin(`/sites/${id}/imports/${source}`, { method: 'DELETE' })
    }
    const restored = await overview()
    expect(restored.sessions.value).toBe(before.sessions.value)
    expect(restored.pageviews.value).toBe(before.pageviews.value)
    expect(restored.visitors.value).toBe(before.visitors.value)
    expect(await browsers()).toEqual({ Chrome: 1 })
    expect(await server.adminJson<unknown[]>(`/sites/${id}/imports`)).toEqual([])
  })
})
