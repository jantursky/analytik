import { afterEach, describe, expect, it } from 'vitest'

import type { Overview, PropertiesResult, ShareLink } from '../src/shared/types'
import { storageKinds } from './helpers/databases'
import { type TestServer, testServer } from './helpers/server'

const RANGE = 'from=2026-03-16&to=2026-03-16&tz=UTC'

describe.each(storageKinds())('goal properties on %s', (kind) => {
  let server: TestServer
  let siteId = ''
  let serial = 0
  afterEach(() => server.close())

  const open = async () => {
    server = await testServer(kind)
    siteId = (await server.createSite({ privacyMode: 'persistent' })).site.id
    serial = 0
  }
  /** One visitor in one session sends a goal, optionally with properties. */
  const goal = async (name: string, p?: Record<string, unknown>, type = 'goal') => {
    serial += 1
    const id = String(serial).padStart(4, '0')
    await server.event({
      w: siteId,
      t: type,
      u: 'https://example.com/',
      m: 'persistent',
      vid: `visitor-${id}`,
      sid: `session-${id}`,
      ...(type === 'goal' && { n: name }),
      ...(p && { p }),
    })
  }
  const read = (suffix = '') => server.adminJson<PropertiesResult>(`/sites/${siteId}/properties?${RANGE}${suffix}`)

  it('lists the keys of a goal with their event counts, and the values of a key', async () => {
    await open()
    for (let i = 0; i < 60; i++) await goal('signup', { plan: 'pro', seats: i % 2 })
    for (let i = 0; i < 40; i++) await goal('signup', { plan: 'free' })
    await goal('other', { colour: 'red' })

    const keys = await read('&name=signup')
    expect(keys.keys).toEqual([
      { key: 'plan', events: 100 },
      { key: 'seats', events: 60 },
    ])
    const values = await read('&name=signup&key=plan')
    expect(values.values).toEqual([
      { value: 'pro', visitors: 60, events: 60 },
      { value: 'free', visitors: 40, events: 40 },
    ])
    expect(values.other).toBeNull()
    // Numbers read as written.
    expect((await read('&name=signup&key=seats')).values.map((row) => [row.value, row.events])).toEqual([
      ['0', 30],
      ['1', 30],
    ])
  })

  it('reads booleans as true and false', async () => {
    await open()
    await goal('signup', { trial: true })
    await goal('signup', { trial: false })
    await goal('signup', { trial: false })
    expect((await read('&name=signup&key=trial')).values.map((row) => [row.value, row.events])).toEqual([
      ['false', 2],
      ['true', 1],
    ])
  })

  it('shows an empty report for a goal without properties', async () => {
    await open()
    await goal('signup')
    expect(await read('&name=signup')).toMatchObject({ keys: [], values: [], other: null })
    expect(await read('&name=nothing&key=plan')).toMatchObject({ values: [], other: null })
  })

  it('shows the 50 most frequent values and the rest as one row', async () => {
    await open()
    for (let value = 0; value < 80; value++) {
      // Value 0 is sent most often, so the ordering is clear.
      for (let i = 0; i < (value === 0 ? 3 : 1); i++) await goal('signup', { code: `v${value}` })
    }
    const result = await read('&name=signup&key=code')
    expect(result.values).toHaveLength(50)
    expect(result.values[0]).toMatchObject({ value: 'v0', events: 3 })
    expect(result.other).toEqual({ visitors: 30, events: 30 })
  })

  it('lists at most 20 keys and only the allowed characters', async () => {
    await open()
    const props: Record<string, number> = { 'a"b': 1, 'with space': 1, ['x'.repeat(65)]: 1, ok_key: 1 }
    for (let i = 0; i < 25; i++) props[`key${String(i).padStart(2, '0')}`] = 1
    // The tracker keeps 30 keys; stay within it.
    const kept = Object.fromEntries(Object.entries(props).slice(0, 30))
    await goal('signup', kept)
    const { keys } = await read('&name=signup')
    expect(keys).toHaveLength(20)
    expect(keys.map((row) => row.key)).not.toContain('a"b')
    expect(keys.map((row) => row.key)).not.toContain('with space')
    expect(keys.every((row) => /^[A-Za-z0-9_.-]{1,64}$/.test(row.key))).toBe(true)
  })

  it('never reads sign-in properties', async () => {
    await open()
    await goal('signup', { plan: 'pro' })
    await goal('', { email: 'ann@example.com' }, 'identify')
    const { keys } = await read('&name=signup')
    expect(keys.map((row) => row.key)).toEqual(['plan'])
  })

  it('rejects a missing goal and a bad key', async () => {
    await open()
    expect((await server.admin(`/sites/${siteId}/properties?${RANGE}`)).status).toBe(400)
    expect((await server.admin(`/sites/${siteId}/properties?${RANGE}&name=signup&key=a%22b`)).status).toBe(400)
    expect((await server.admin(`/sites/${siteId}/properties?${RANGE}&name=signup&key=${'k'.repeat(65)}`)).status).toBe(
      400,
    )
  })

  it('needs a login, and is read through a share link that allows the Events view', async () => {
    await open()
    await goal('signup', { plan: 'pro' })
    expect((await server.request(`/sites/${siteId}/properties?${RANGE}&name=signup`)).status).toBe(401)
    const make = async (views: string[]) =>
      (
        await server.adminJson<{ link: ShareLink; token: string }>(`/sites/${siteId}/share-links`, {
          method: 'POST',
          json: { views },
        })
      ).token
    const events = await make(['events'])
    const sessions = await make(['sessions'])
    expect((await server.request(`/sites/${siteId}/properties?${RANGE}&name=signup&share=${events}`)).status).toBe(200)
    expect((await server.request(`/sites/${siteId}/properties?${RANGE}&name=signup&share=${sessions}`)).status).toBe(
      401,
    )
    const bearer = await server.request(`/sites/${siteId}/properties?${RANGE}&name=signup`, {
      headers: { authorization: `Bearer ${server.token}` },
    })
    expect(bearer.status).toBe(200)
  })

  it('is available to server code as stats.properties()', async () => {
    await open()
    await goal('signup', { plan: 'pro' })
    const query = { from: Date.UTC(2026, 2, 16), to: Date.UTC(2026, 2, 17), tz: 'UTC' }
    const result = await server.analytik.stats.properties(siteId, query, { name: 'signup', key: 'plan' })
    expect(result.values).toEqual([{ value: 'pro', visitors: 1, events: 1 }])
  })

  describe('as a filter', () => {
    const sessionsIn = async (suffix: string) =>
      (await server.adminJson<Overview>(`/sites/${siteId}/overview?${RANGE}${suffix}`)).sessions.value

    const seed = async () => {
      await open()
      for (let i = 0; i < 3; i++) await goal('signup', { plan: 'pro' })
      for (let i = 0; i < 2; i++) await goal('signup', { plan: 'free' })
      await goal('upgrade', { plan: 'pro' })
    }

    it('narrows the views to sessions with a goal event carrying the value', async () => {
      await seed()
      expect(await sessionsIn('')).toBe(6)
      expect(await sessionsIn('&prop%3Aplan=pro')).toBe(4)
      expect(await sessionsIn('&prop%3Aplan=free')).toBe(2)
      expect(await sessionsIn('&prop%3Aplan=pro&prop%3Aplan=free')).toBe(6)
      const pages = await server.adminJson<{ key: string }[]>(
        `/sites/${siteId}/breakdown?${RANGE}&dimension=goal&prop%3Aplan=free`,
      )
      expect(pages.map((row) => row.key)).toEqual(['signup'])
      const list = await server.adminJson<{ items: unknown[] }>(`/sites/${siteId}/sessions?${RANGE}&prop%3Aplan=free`)
      expect(list.items).toHaveLength(2)
    })

    it('needs the same event to match the goal and the value', async () => {
      await seed()
      await goal('signup', { plan: 'enterprise' })
      // Visitor 7 has only a signup with plan enterprise; no upgrade has it.
      expect(await sessionsIn('&goal=upgrade&prop%3Aplan=pro')).toBe(1)
      expect(await sessionsIn('&goal=upgrade&prop%3Aplan=free')).toBe(0)
      expect(await sessionsIn('&goal=signup&prop%3Aplan=enterprise')).toBe(1)
    })

    it('finds nothing for a key no event has, and does not fail on a bad one', async () => {
      await seed()
      expect(await sessionsIn('&prop%3Acolour=red')).toBe(0)
      // An invalid key is ignored like an unknown parameter.
      expect(await sessionsIn('&prop%3Aa%22b=x')).toBe(6)
    })

    it('narrows the property report itself', async () => {
      await seed()
      const result = await read('&name=signup&key=plan&prop%3Aplan=pro')
      expect(result.values).toEqual([{ value: 'pro', visitors: 3, events: 3 }])
    })
  })
})
