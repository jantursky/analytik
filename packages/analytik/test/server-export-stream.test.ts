import { describe, expect, it } from 'vitest'

import { exportCsv, exportCsvStream, exportNdjson, exportPages, readExport } from '../src/server/stats/export'
import { getSite } from '../src/server/sites'
import { DAY } from '../src/shared/time'
import { storageKinds } from './helpers/databases'
import { START, type TestServer, testServer } from './helpers/server'

const text = async (stream: ReadableStream<Uint8Array>) => new Response(stream).text()

describe.each(storageKinds())('streamed export on %s', (kind) => {
  const setup = async (events: number) => {
    const server: TestServer = await testServer(kind)
    const { site } = await server.createSite()
    // Every few events share one time, so a page boundary can fall inside a group of equal keys.
    for (let i = 0; i < events; i++) {
      server.now = START - Math.floor(i / 3) * DAY
      await server.event({
        w: site.id,
        t: 'pageview',
        u: `https://example.com/p${i}`,
        m: 'persistent',
        vid: `v${i}`,
        sid: `s${i}`,
      })
    }
    server.now = START
    const record = await getSite(server.context, site.id)
    return { server, site, record: record! }
  }

  it('pages without skipping or repeating rows that share a key', async () => {
    const { server, site } = await setup(10)
    const ids: string[] = []
    let pages = 0
    for await (const page of exportPages(server.context, site.id, 'events', 4)) {
      pages++
      ids.push(...page.map((row) => String(row.id)))
    }
    expect(pages).toBe(Math.ceil(ids.length / 4))
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBe(10)
    await server.close()
  })

  it('writes a header, then every row with its table, and reads back', async () => {
    const { server, record } = await setup(7)
    const out = await text(exportNdjson(server.context, record, 3))
    const lines = out.trimEnd().split('\n')
    expect(JSON.parse(lines[0]!)).toMatchObject({ version: 2, site: { id: record.id } })
    expect(lines.filter((line) => (JSON.parse(line) as { table: string }).table === 'events')).toHaveLength(7)
    expect(out).not.toContain('api_key_hash')
    const parsed = readExport(out)
    expect(parsed.version).toBe(2)
    expect(parsed.tables.events).toHaveLength(7)
    expect(parsed.tables.sessions.length).toBeGreaterThan(0)
    await server.close()
  })

  it('writes the CSV the string version writes', async () => {
    const { server, record } = await setup(8)
    await server.storage.run("UPDATE events SET name = '=SUM(1)' WHERE path = '/p1'")
    const streamed = await text(exportCsvStream(server.context, record, 'events', 3))
    expect(streamed).toBe(await exportCsv(server.context, record, 'events'))
    expect(streamed).toContain("'=SUM(1)")
    expect(await text(exportCsvStream(server.context, record, 'payments', 3))).toBe('')
    await server.close()
  })

  it('reads one page at a time, not the whole table first', async () => {
    const { server, record } = await setup(9)
    const query = server.storage.query.bind(server.storage)
    let queries = 0
    server.storage.query = (sql: string, params?: unknown[]) => (queries++, query(sql, params))
    const reader = exportNdjson(server.context, record, 2).getReader()
    await reader.read() // header
    await reader.read() // first page of visitors (or an empty table)
    expect(queries).toBeLessThan(4)
    await reader.cancel()
    await server.close()
  })
})

describe('a large site', () => {
  it('streams 50,000 events in pages, never as one string', async () => {
    const server = await testServer('sqlite')
    const { site } = await server.createSite()
    const record = (await getSite(server.context, site.id))!
    const total = 50_000
    for (let from = 0; from < total; from += 1000) {
      await server.storage.batch(
        Array.from({ length: 1000 }, (_, i) => ({
          sql: `INSERT INTO events (id, site_id, session_id, visitor_id, ts, type, name, path, props) VALUES (?, ?, 's', 'v', ?, 'pageview', NULL, ?, NULL)`,
          params: [`e${from + i}`, site.id, START - (from + i), `/page/${from + i}`],
        })),
      )
    }
    const reader = exportNdjson(server.context, record).getReader()
    const decoder = new TextDecoder()
    let largest = 0
    let events = 0
    let tail = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      largest = Math.max(largest, value.byteLength)
      const lines = (tail + decoder.decode(value, { stream: true })).split('\n')
      tail = lines.pop() ?? ''
      events += lines.filter((line) => line.startsWith('{"table":"events"')).length
    }
    expect(events).toBe(total)
    // One page of 1000 rows is far below the megabytes the whole table would take.
    expect(largest).toBeLessThan(500_000)
    await server.close()
  }, 60_000)
})

describe('readExport', () => {
  it('understands the version 1 single document', () => {
    const doc = {
      version: 1,
      exportedAt: 5,
      site: { id: 'a' },
      visitors: [],
      sessions: [],
      events: [{ id: 'e' }],
      payments: [],
      funnels: [],
    }
    const parsed = readExport(JSON.stringify(doc))
    expect(parsed).toMatchObject({ version: 1, exportedAt: 5, site: { id: 'a' } })
    expect(parsed.tables.events).toEqual([{ id: 'e' }])
  })

  it('refuses what is not an analytik export', () => {
    expect(() => readExport('{"version":3}')).toThrow('unknown export version 3')
    expect(() => readExport('{"a":1}')).toThrow('not an analytik export')
    expect(() => readExport('{"version":2}\n{"table":"nope"}')).toThrow('unknown table')
  })
})
