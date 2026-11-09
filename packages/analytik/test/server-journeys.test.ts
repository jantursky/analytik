import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DAY } from '../src/shared/time'
import type { JourneysResult, Site } from '../src/shared/types'
import {
  JOURNEY_MAX_DAYS,
  JOURNEY_NODES_PER_STEP,
  JOURNEY_SESSION_CAP,
  JOURNEY_STEPS,
  journeyPathsStatement,
} from '../src/server/stats/journeys'
import { toStatsQuery } from '../src/server/stats/query'
import { storageKinds } from './helpers/databases'
import { type TestServer, testServer } from './helpers/server'

const DAY_START = Date.UTC(2026, 2, 16)

describe.each(storageKinds())('journeys on %s', (kind) => {
  let server: TestServer
  let site: Site
  let serial = 0
  beforeEach(async () => {
    server = await testServer(kind)
    site = (await server.createSite({ privacyMode: 'persistent' })).site
    serial = 0
  })
  afterEach(() => server.close())

  /** One session that views the pages in order, a minute apart. */
  const visit = async (pages: string[], headers: Record<string, string> = {}) => {
    serial += 1
    const ids = { m: 'persistent', vid: `visitor-${String(serial).padStart(4, '0')}`, sid: `session-${serial}` }
    for (const page of pages) {
      server.advance(1)
      await server.event({ w: site.id, t: 'pageview', u: `https://example.com${page}`, ...ids }, headers)
    }
  }
  const read = (suffix = '') =>
    server.adminJson<JourneysResult>(`/sites/${site.id}/journeys?from=2026-03-01&to=2026-03-31&tz=UTC${suffix}`)
  const node = (result: JourneysResult, id: string) => result.nodes.find((n) => n.id === id)
  const link = (result: JourneysResult, from: string, to: string) =>
    result.links.find((l) => l.from === from && l.to === to)?.sessions

  beforeEach(() => {
    server.now = DAY_START + 8 * 3_600_000
  })

  it('follows the most common first pages and where sessions end', async () => {
    await visit(['/', '/pricing', '/signup'])
    await visit(['/', '/pricing', '/signup'])
    await visit(['/', '/pricing'])
    await visit(['/', '/blog'])
    await visit(['/pricing'])
    const result = await read()
    expect(result.sessions).toBe(5)
    expect(result.multiPage).toBe(4)
    expect(node(result, '1:/')?.sessions).toBe(4)
    expect(node(result, '1:/pricing')?.sessions).toBe(1)
    expect(link(result, '1:/', '2:/pricing')).toBe(3)
    expect(link(result, '2:/pricing', '3:/signup')).toBe(2)
    expect(link(result, '2:/pricing', '3:exit')).toBe(1)
    expect(link(result, '3:/signup', '4:exit')).toBe(2)
    expect(link(result, '1:/pricing', '2:exit')).toBe(1)
  })

  it('counts a reload once and keeps the order of pages', async () => {
    await visit(['/', '/', '/pricing', '/pricing', '/', '/pricing'])
    const result = await read()
    expect(link(result, '1:/', '2:/pricing')).toBe(1)
    expect(link(result, '2:/pricing', '3:/')).toBe(1)
    expect(link(result, '3:/', '4:/pricing')).toBe(1)
    expect(link(result, '4:/pricing', '5:exit')).toBe(1)
  })

  it('does not end a session that goes on past the drawn steps', async () => {
    await visit(['/a', '/b', '/c', '/d', '/e', '/f'])
    const result = await read()
    expect(JOURNEY_STEPS).toBe(4)
    expect(node(result, '4:/d')?.sessions).toBe(1)
    expect(result.nodes.some((n) => n.kind === 'exit')).toBe(false)
  })

  it('groups the rarest pages of a step as Other', async () => {
    for (let page = 0; page < JOURNEY_NODES_PER_STEP + 3; page++) await visit([`/p${String(page).padStart(2, '0')}`])
    await visit(['/p00'])
    const result = await read()
    const first = result.nodes.filter((n) => n.step === 1)
    expect(first).toHaveLength(JOURNEY_NODES_PER_STEP + 1)
    expect(node(result, '1:/p00')?.sessions).toBe(2)
    expect(node(result, '1:*')).toMatchObject({ kind: 'other', path: null, sessions: 3 })
  })

  it('applies the filters of the request', async () => {
    await visit(['/', '/pricing'], { 'x-vercel-ip-country': 'DE' })
    await visit(['/', '/blog'], { 'x-vercel-ip-country': 'US' })
    const all = await read()
    const german = await read('&country=DE')
    expect(all.sessions).toBe(2)
    expect(german.sessions).toBe(1)
    expect(link(german, '1:/', '2:/pricing')).toBe(1)
    expect(link(german, '1:/', '2:/blog')).toBeUndefined()
  })

  it('reads only the last 30 days of a longer range', async () => {
    const result = await server.adminJson<JourneysResult>(
      `/sites/${site.id}/journeys?from=2025-01-01&to=2026-03-31&tz=UTC`,
    )
    expect(result.capped).toBe(true)
    expect(result.to - result.from).toBe(JOURNEY_MAX_DAYS * DAY)
    const short = await server.adminJson<JourneysResult>(
      `/sites/${site.id}/journeys?from=2026-03-10&to=2026-03-31&tz=UTC`,
    )
    expect(short.capped).toBe(false)
  })

  it('says nothing happened for a site without page views', async () => {
    expect(await read()).toMatchObject({ sessions: 0, multiPage: 0, nodes: [], links: [] })
  })

  it('finds pageviews by session id, never by scanning the whole events table', async () => {
    await visit(['/', '/pricing'])
    const query = toStatsQuery(
      { timezone: 'UTC' } as Parameters<typeof toStatsQuery>[0],
      {
        from: DAY_START - DAY,
        to: DAY_START + DAY,
      },
      'sqlite',
    )
    const { sql, params } = journeyPathsStatement(site.id, query)
    expect(JOURNEY_SESSION_CAP).toBe(5000)
    if (kind === 'postgres' || kind === 'pg') {
      // The planner of a nearly empty table may choose anything; the statement must at least run.
      await server.rows(`EXPLAIN ${sql}`, params)
      return
    }
    const plan = (await server.rows<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, params)).map((row) => row.detail)
    expect(plan.some((line) => line.includes('events_session'))).toBe(true)
    expect(plan.some((line) => /^SCAN (events|e)\b/.test(line))).toBe(false)
  })

  it('reads at most the newest sessions of a busy site', async () => {
    const statements = []
    const extra = 120
    for (let n = 0; n < JOURNEY_SESSION_CAP + extra; n++) {
      const id = `bulk-${n}`
      statements.push(
        {
          sql: `INSERT INTO sessions (site_id, id, visitor_id, started_at, last_seen_at, source, channel)
                VALUES (?, ?, ?, ?, ?, 'Direct', 'Direct')`,
          params: [site.id, id, `v-${n}`, DAY_START + n, DAY_START + n],
        },
        {
          sql: `INSERT INTO events (id, site_id, session_id, visitor_id, ts, type, path)
                VALUES (?, ?, ?, ?, ?, 'pageview', ?)`,
          params: [`e-${n}`, site.id, id, `v-${n}`, DAY_START + n, n < extra ? '/old' : '/new'],
        },
      )
    }
    for (let at = 0; at < statements.length; at += 500) await server.storage.batch(statements.slice(at, at + 500))
    const result = await read()
    expect(result.sessions).toBe(JOURNEY_SESSION_CAP)
    // The oldest sessions are the ones left out.
    expect(node(result, '1:/old')).toBeUndefined()
    expect(node(result, '1:/new')?.sessions).toBe(JOURNEY_SESSION_CAP)
  }, 60_000)

  it('is for admins only and may be kept by the browser for a few minutes', async () => {
    const anonymous = await server.request(`/sites/${site.id}/journeys?from=2026-03-01&to=2026-03-31`)
    expect(anonymous.status).toBe(401)
    const response = await server.admin(`/sites/${site.id}/journeys?from=2026-03-01&to=2026-03-31&tz=UTC`)
    expect(response.headers.get('cache-control')).toBe('private, max-age=300')
    const { token } = await server.adminJson<{ token: string }>(`/sites/${site.id}/share-links`, {
      method: 'POST',
      json: {},
    })
    const shared = await server.request(`/sites/${site.id}/journeys?from=2026-03-01&to=2026-03-31`, {
      headers: { 'x-analytik-share': token },
    })
    expect(shared.status).toBe(401)
  })
})
