import { afterEach, describe, expect, it } from 'vitest'

import { DAY } from '../src/shared/time'
import type { PrivacyMode, RetentionResult, Site } from '../src/shared/types'
import { RETENTION_COHORTS, RETENTION_WEEKS } from '../src/server/stats/retention'
import { storageKinds } from './helpers/databases'
import { type TestServer, testServer } from './helpers/server'

// Monday 2 March 2026 is the start of the first cohort week.
const WEEK_1 = Date.UTC(2026, 2, 2)
const NOON = 12 * 3_600_000

describe.each(storageKinds())('retention on %s', (kind) => {
  let server: TestServer
  let site: Site
  let serial = 0

  const open = async (privacyMode: PrivacyMode = 'persistent') => {
    server = await testServer(kind)
    site = (await server.createSite({ privacyMode })).site
    serial = 0
  }
  afterEach(() => server.close())

  /** A visitor viewing the site `week` weeks after the first cohort week (day 0 is Monday). */
  const visit = async (visitor: string, week: number, day = 0, headers: Record<string, string> = {}) => {
    serial += 1
    server.now = WEEK_1 + (week * 7 + day) * DAY + NOON
    await server.event(
      { w: site.id, t: 'pageview', u: 'https://example.com/', m: 'persistent', vid: visitor, sid: `session-${serial}` },
      headers,
    )
  }
  const read = (suffix = '', from = '2026-03-02', to = '2026-04-27') =>
    server.adminJson<RetentionResult>(`/sites/${site.id}/retention?from=${from}&to=${to}&tz=UTC${suffix}`)

  it('shows the share of a weekly cohort that returned in each following week', async () => {
    await open()
    for (let i = 0; i < 10; i++) await visit(`visitor-a-${i}`, 0)
    for (let i = 0; i < 3; i++) await visit(`visitor-a-${i}`, 1, 2)
    await visit('visitor-a-0', 3)
    await visit('visitor-a-0', 3, 4) // two sessions in one week are one active visitor
    const result = await read()
    expect(result.available).toBe(true)
    const [first] = result.cohorts
    expect(first?.week).toBe(WEEK_1)
    expect(first?.size).toBe(10)
    expect(first?.active.slice(0, 4)).toEqual([10, 3, 0, 1])
  })

  it('starts a new cohort for visitors first seen in a later week, and lists only weeks that have happened', async () => {
    await open()
    for (let i = 0; i < 4; i++) await visit(`visitor-b-${i}`, 0)
    for (let i = 0; i < 5; i++) await visit(`visitor-c-${i}`, 1)
    await visit('visitor-b-0', 1)
    await visit('visitor-c-0', 2)
    const result = await read('', '2026-03-02', '2026-03-22') // three weeks: 2, 9 and 16 March (the end date is included)
    expect(result.cohorts.map((c) => [c.size, c.active])).toEqual([
      [4, [4, 1, 0]],
      [5, [5, 1]],
    ])
  })

  it('applies filters to the first session of each visitor', async () => {
    await open()
    await visit('visitor-d-1', 0, 0, { 'x-vercel-ip-country': 'DE' })
    await visit('visitor-d-2', 0, 0, { 'x-vercel-ip-country': 'US' })
    await visit('visitor-d-1', 1, 0, { 'x-vercel-ip-country': 'US' })
    await visit('visitor-d-2', 1, 0, { 'x-vercel-ip-country': 'DE' })
    const german = await read('&country=DE')
    expect(german.cohorts.map((c) => [c.size, c.active[0], c.active[1]])).toEqual([[1, 1, 1]])
  })

  it('computes only the latest 12 weekly cohorts of a long range', async () => {
    await open()
    // One new visitor per week for 20 weeks.
    for (let week = 0; week < 20; week++) await visit(`visitor-e-${week}`, week)
    server.now = WEEK_1 // the admin login does not outlive months of test clock
    const result = await read('', '2026-03-02', '2026-07-19')
    expect(result.cohorts).toHaveLength(RETENTION_COHORTS)
    expect(result.cohorts[0]?.week).toBe(WEEK_1 + 8 * 7 * DAY)
    expect(result.cohorts.at(-1)?.week).toBe(WEEK_1 + 19 * 7 * DAY)
    for (const cohort of result.cohorts) expect(cohort.active.length).toBeLessThanOrEqual(RETENTION_WEEKS)
  })

  it('gives an empty answer for a site without visitors', async () => {
    await open()
    const result = await read()
    expect(result).toMatchObject({ available: true, cohorts: [] })
  })

  it.each(['strict', 'enriched'] as const)('is not offered in the %s privacy mode', async (mode) => {
    await open(mode)
    const result = await read()
    expect(result).toMatchObject({ available: false, privacyMode: mode, cohorts: [] })
  })

  it('is for admins only and may be kept by the browser for a few minutes', async () => {
    await open()
    const query = `from=2026-03-02&to=2026-04-27&tz=UTC`
    expect((await server.request(`/sites/${site.id}/retention?${query}`)).status).toBe(401)
    const response = await server.admin(`/sites/${site.id}/retention?${query}`)
    expect(response.headers.get('cache-control')).toBe('private, max-age=300')
    const { token } = await server.adminJson<{ token: string }>(`/sites/${site.id}/share-links`, {
      method: 'POST',
      json: {},
    })
    const shared = await server.request(`/sites/${site.id}/retention?${query}`, {
      headers: { 'x-analytik-share': token },
    })
    expect(shared.status).toBe(401)
  })
})
