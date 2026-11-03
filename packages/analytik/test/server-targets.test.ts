import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { periodBounds } from '../src/shared/time'
import type { GoalTarget, TargetsResult } from '../src/shared/types'
import { storageKinds } from './helpers/databases'
import { type TestServer, testServer } from './helpers/server'

const MARCH_16 = Date.UTC(2026, 2, 16, 12)

describe('periodBounds', () => {
  it('starts weeks on Monday, months on the 1st and quarters on January, April, July and October', () => {
    expect(periodBounds(MARCH_16, 'week', 'UTC')).toEqual({ start: Date.UTC(2026, 2, 16), end: Date.UTC(2026, 2, 23) })
    expect(periodBounds(MARCH_16, 'month', 'UTC')).toEqual({ start: Date.UTC(2026, 2, 1), end: Date.UTC(2026, 3, 1) })
    expect(periodBounds(MARCH_16, 'quarter', 'UTC')).toEqual({ start: Date.UTC(2026, 0, 1), end: Date.UTC(2026, 3, 1) })
    expect(periodBounds(Date.UTC(2026, 10, 3), 'quarter', 'UTC')).toEqual({
      start: Date.UTC(2026, 9, 1),
      end: Date.UTC(2027, 0, 1),
    })
  })

  it('follows the time zone, including a quarter that ends in a daylight saving change', () => {
    // 2026-02-28 23:30 in New York is already March 1 in UTC.
    const lateFebruary = Date.UTC(2026, 2, 1, 4, 30)
    expect(periodBounds(lateFebruary, 'month', 'America/New_York').start).toBe(Date.UTC(2026, 1, 1, 5))
    expect(periodBounds(lateFebruary, 'month', 'UTC').start).toBe(Date.UTC(2026, 2, 1))
    // New York's clocks go forward on March 8: the quarter starts at UTC-5 and the next one at UTC-4.
    expect(periodBounds(MARCH_16, 'quarter', 'America/New_York')).toEqual({
      start: Date.UTC(2026, 0, 1, 5),
      end: Date.UTC(2026, 3, 1, 4),
    })
  })
})

describe.each(storageKinds())('goal targets on %s', (kind) => {
  let server: TestServer
  beforeEach(async () => {
    server = await testServer(kind)
  })
  afterEach(() => server.close())

  const create = async (targets: GoalTarget[], input: Record<string, unknown> = {}) => {
    const { site } = await server.createSite(input)
    await server.admin(`/sites/${site.id}`, { method: 'PATCH', json: { targets } })
    return site
  }
  const goal = (siteId: string, name: string, at: number) => {
    server.now = at - 1
    return server.event({ w: siteId, t: 'goal', n: name, u: 'https://example.com/' })
  }
  const progress = (siteId: string, suffix = '') => server.adminJson<TargetsResult>(`/sites/${siteId}/targets${suffix}`)
  const eventReads = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.filter(([sql]) => String(sql).includes('FROM events')).length

  it('counts a goal in its period and projects the month end', async () => {
    const site = await create([{ goal: 'signup', target: 10, period: 'month' }])
    for (const at of [Date.UTC(2026, 2, 2), Date.UTC(2026, 2, 9), Date.UTC(2026, 2, 12)]) {
      await goal(site.id, 'signup', at)
    }
    await goal(site.id, 'signup', Date.UTC(2026, 1, 27))
    await goal(site.id, 'download', Date.UTC(2026, 2, 5))
    server.now = MARCH_16

    const { targets } = await progress(site.id)
    // Half the month has passed with three signups, so the month ends near six.
    expect(targets).toEqual([
      {
        goal: 'signup',
        target: 10,
        period: 'month',
        count: 3,
        start: Date.UTC(2026, 2, 1),
        end: Date.UTC(2026, 3, 1),
        projection: 6,
      },
    ])
  })

  it('shows the target period, whatever range the toolbar shows', async () => {
    const site = await create([{ goal: 'signup', target: 10, period: 'month' }])
    await goal(site.id, 'signup', Date.UTC(2026, 2, 2))
    server.now = MARCH_16
    const wide = await progress(site.id)
    const narrow = await progress(site.id, '?from=2026-03-14&to=2026-03-16')
    expect(narrow).toEqual(wide)
    expect(narrow.targets[0]?.count).toBe(1)
  })

  it('starts a period at midnight in the site time zone', async () => {
    const targets: GoalTarget[] = [{ goal: 'signup', target: 5, period: 'month' }]
    const auckland = await create(targets, { timezone: 'Pacific/Auckland' })
    const utc = await create(targets, { domain: 'utc.example.com' })
    // Noon UTC on February 28 is already 01:00 on March 1 in Auckland.
    for (const site of [auckland, utc]) await goal(site.id, 'signup', Date.UTC(2026, 1, 28, 12))
    server.now = MARCH_16
    expect((await progress(auckland.id)).targets[0]).toMatchObject({ count: 1, start: Date.UTC(2026, 1, 28, 11) })
    expect((await progress(utc.id)).targets[0]).toMatchObject({ count: 0, start: Date.UTC(2026, 2, 1) })
  })

  it('counts a goal at the last millisecond of a period and none from the next one', async () => {
    const site = await create([{ goal: 'signup', target: 5, period: 'week' }])
    await goal(site.id, 'signup', Date.UTC(2026, 2, 16, 0))
    await goal(site.id, 'signup', Date.UTC(2026, 2, 15, 23, 59, 59))
    server.now = MARCH_16
    expect((await progress(site.id)).targets[0]?.count).toBe(1)
  })

  it('holds back the projection until a tenth of the period has passed', async () => {
    const site = await create([{ goal: 'signup', target: 10, period: 'month' }])
    await goal(site.id, 'signup', Date.UTC(2026, 2, 1, 2))
    server.now = Date.UTC(2026, 2, 3)
    expect((await progress(site.id)).targets[0]).toMatchObject({ count: 1, projection: null })
    server.now = Date.UTC(2026, 2, 5)
    expect((await progress(site.id)).targets[0]?.projection).toBe(8)
  })

  it('serves every target of one period with one query', async () => {
    const site = await create([
      { goal: 'signup', target: 10, period: 'month' },
      { goal: 'download', target: 20, period: 'month' },
      { goal: 'contact', target: 5, period: 'month' },
    ])
    await goal(site.id, 'download', Date.UTC(2026, 2, 5))
    server.now = MARCH_16
    const spy = vi.spyOn(server.storage, 'query')
    const { targets } = await progress(site.id)
    expect(eventReads(spy)).toBe(1)
    expect(targets.map((t) => [t.goal, t.count])).toEqual([
      ['signup', 0],
      ['download', 1],
      ['contact', 0],
    ])
  })

  it('uses one query per period type, and none without targets', async () => {
    const site = await create([
      { goal: 'signup', target: 10, period: 'month' },
      { goal: 'signup', target: 3, period: 'week' },
      { goal: 'download', target: 50, period: 'quarter' },
    ])
    const bare = await create([], { domain: 'bare.example.com' })
    server.now = MARCH_16
    const spy = vi.spyOn(server.storage, 'query')
    await progress(site.id)
    expect(eventReads(spy)).toBe(3)
    spy.mockClear()
    expect((await progress(bare.id)).targets).toEqual([])
    expect(eventReads(spy)).toBe(0)
  })

  it('stays admin only: a share link never reads the targets', async () => {
    const site = await create([{ goal: 'signup', target: 10, period: 'month' }])
    const { token } = await server.adminJson<{ token: string }>(`/sites/${site.id}/share-links`, {
      method: 'POST',
      json: {},
    })
    expect((await server.request(`/sites/${site.id}/targets?share=${token}`)).status).toBe(401)
    expect((await server.request(`/sites/${site.id}/targets`)).status).toBe(401)
    expect((await server.admin(`/sites/${site.id}/targets`)).headers.get('cache-control')).toBe('private, max-age=60')
  })

  it('is part of the programmatic stats API', async () => {
    const site = await create([{ goal: 'signup', target: 10, period: 'week' }])
    server.now = MARCH_16
    expect((await server.analytik.stats.targets(site.id)).targets[0]).toMatchObject({ goal: 'signup', count: 0 })
    await expect(server.analytik.stats.targets('missing')).rejects.toThrow('site not found')
  })
})
