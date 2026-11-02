import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DAY } from '../src/shared/time'
import type { Annotation, TimeseriesPoint } from '../src/shared/types'
import { type TestServer, testServer } from './helpers/server'

let server: TestServer
beforeEach(async () => {
  server = await testServer()
})
afterEach(() => server.close())

const DAY_ONE = Date.UTC(2026, 2, 3)
const range = '?from=2026-03-01&to=2026-03-07&interval=day&tz=UTC'

const post = (siteId: string, json: unknown) => server.admin(`/sites/${siteId}/annotations`, { method: 'POST', json })
const series = (siteId: string, suffix = range) =>
  server.adminJson<TimeseriesPoint[]>(`/sites/${siteId}/timeseries${suffix}`)

describe('chart annotations', () => {
  it('add a note that rides on the bucket of its date in the chart response', async () => {
    const { site } = await server.createSite()
    const response = await post(site.id, { text: 'Launch', ts: '2026-03-03' })
    expect(response.status).toBe(201)
    const note = (await response.json()) as Annotation
    expect(note).toMatchObject({ text: 'Launch', ts: DAY_ONE, createdAt: server.now })

    const points = await series(site.id)
    expect(points).toHaveLength(7)
    expect(points.filter((p) => p.notes).map((p) => [p.ts, p.notes])).toEqual([[DAY_ONE, [note]]])
  })

  it('put a note on the bucket that holds its time, whatever the interval', async () => {
    const { site } = await server.createSite()
    await post(site.id, { text: 'Deploy', ts: Date.UTC(2026, 2, 3, 15, 30) })
    const hourly = await series(site.id, '?from=2026-03-03&to=2026-03-04&interval=hour&tz=UTC')
    expect(hourly.find((p) => p.notes)?.ts).toBe(Date.UTC(2026, 2, 3, 15))
    const daily = await series(site.id)
    expect(daily.find((p) => p.notes)?.ts).toBe(DAY_ONE)
  })

  it('send only the notes of the visible range, and a bounded number of them', async () => {
    const { site } = await server.createSite()
    await post(site.id, { text: 'Before', ts: '2026-02-20' })
    await post(site.id, { text: 'After', ts: '2026-04-01' })
    expect((await series(site.id)).some((p) => p.notes)).toBe(false)
    for (let i = 0; i < 105; i++) await post(site.id, { text: `n${i}`, ts: DAY_ONE + i * 1000 })
    const noted = (await series(site.id)).flatMap((p) => p.notes ?? [])
    expect(noted).toHaveLength(100)
    expect(noted.map((n) => n.text).slice(0, 3)).toEqual(['n0', 'n1', 'n2'])
  })

  it('cost one indexed read in the existing request', async () => {
    const { site } = await server.createSite()
    await post(site.id, { text: 'Launch', ts: '2026-03-03' })
    const spy = vi.spyOn(server.storage, 'query')
    await series(site.id)
    const reads = spy.mock.calls.map(([sql]) => sql).filter((sql) => sql.includes('annotations'))
    expect(reads).toHaveLength(1)
    expect(reads[0]).toContain('site_id = ? AND ts >= ? AND ts < ?')
    const plan = await server.storage.query<{ detail: string }>(`EXPLAIN QUERY PLAN ${reads[0]}`, [site.id, 0, 1])
    expect(plan.map((row) => row.detail).join(' ')).toContain('annotations_site_ts')
  })

  it('edit and delete a note, and refuse a note of another site', async () => {
    const { site } = await server.createSite()
    const other = (await server.createSite({ domain: 'other.com' })).site
    const note = (await (await post(site.id, { text: 'Launch', ts: '2026-03-03' })).json()) as Annotation
    const path = (siteId: string) => `/sites/${siteId}/annotations/${note.id}`

    expect((await server.admin(path(other.id), { method: 'PATCH', json: { text: 'x' } })).status).toBe(404)
    expect((await server.admin(path(other.id), { method: 'DELETE' })).status).toBe(404)
    const edited = await server.adminJson<Annotation>(path(site.id), {
      method: 'PATCH',
      json: { text: 'Launch v2', ts: '2026-03-04' },
    })
    expect(edited).toMatchObject({ id: note.id, text: 'Launch v2', ts: DAY_ONE + DAY })
    expect((await series(site.id)).find((p) => p.notes)?.ts).toBe(DAY_ONE + DAY)
    expect((await server.admin(path(site.id), { method: 'DELETE' })).status).toBe(200)
    expect((await series(site.id)).some((p) => p.notes)).toBe(false)
    expect((await server.admin(path(site.id), { method: 'DELETE' })).status).toBe(404)
  })

  it('keep the text bounded and plain', async () => {
    const { site } = await server.createSite()
    for (const json of [{}, { text: '' }, { text: '   ' }, { text: 5 }, { text: 'x'.repeat(201) }]) {
      expect((await post(site.id, json)).status, JSON.stringify(json)).toBe(400)
    }
    expect((await post(site.id, { text: 'é'.repeat(200) })).status).toBe(201)
    const note = (await (await post(site.id, { text: 'a\u0000b\n\tc  <b>d</b>' })).json()) as Annotation
    expect(note.text).toBe('a b c <b>d</b>')
  })

  it('check the date', async () => {
    const { site } = await server.createSite()
    for (const ts of ['soon', '2026-13-45', -5, null, {}, 'March 3', Date.UTC(2030, 0, 1)]) {
      expect((await post(site.id, { text: 'x', ts })).status, JSON.stringify(ts)).toBe(400)
    }
    const now = (await (await post(site.id, { text: 'now' })).json()) as Annotation
    expect(now.ts).toBe(server.now)
    expect(((await (await post(site.id, { text: 'ms', ts: DAY_ONE })).json()) as Annotation).ts).toBe(DAY_ONE)
    expect(
      ((await (await post(site.id, { text: 'iso', ts: '2026-03-03T10:00:00+02:00' })).json()) as Annotation).ts,
    ).toBe(Date.UTC(2026, 2, 3, 8))
  })

  it('stop at a note limit per site', async () => {
    const { site } = await server.createSite()
    const values = Array.from({ length: 2000 }, (_, i) => `('n${i}', '${site.id}', ${i}, 't', 0)`).join(',')
    await server.storage.run(`INSERT INTO annotations (id, site_id, ts, text, created_at) VALUES ${values}`)
    expect((await post(site.id, { text: 'one more' })).status).toBe(400)
  })

  it('need an admin to change, and a share link can read but not change them', async () => {
    const { site } = await server.createSite()
    const note = (await (await post(site.id, { text: 'Launch', ts: '2026-03-03' })).json()) as Annotation
    expect(
      (await server.request(`/sites/${site.id}/annotations`, { method: 'POST', body: JSON.stringify({ text: 'x' }) }))
        .status,
    ).toBe(401)
    const { token } = await server.adminJson<{ token: string }>(`/sites/${site.id}/share-links`, {
      method: 'POST',
      json: {},
    })
    const shared = (await (
      await server.request(`/sites/${site.id}/timeseries${range}&share=${token}`)
    ).json()) as TimeseriesPoint[]
    expect(shared.flatMap((p) => p.notes ?? [])).toEqual([note])
    for (const [method, path] of [
      ['POST', `/sites/${site.id}/annotations`],
      ['PATCH', `/sites/${site.id}/annotations/${note.id}`],
      ['DELETE', `/sites/${site.id}/annotations/${note.id}`],
    ] as const) {
      const response = await server.request(`${path}?share=${token}`, { method, body: JSON.stringify({ text: 'x' }) })
      expect(response.status, `${method} ${path}`).toBe(401)
    }
  })

  it('come with the comparison series without doubling up', async () => {
    const { site } = await server.createSite()
    await post(site.id, { text: 'Launch', ts: '2026-03-03' })
    const points = await series(site.id, `${range}&compare=previous`)
    expect(points.flatMap((p) => p.notes ?? [])).toHaveLength(1)
    expect(JSON.stringify(points.map((p) => p.previous))).not.toContain('notes')
  })

  it('are removed with their site', async () => {
    const { site } = await server.createSite()
    await post(site.id, { text: 'Launch' })
    await server.admin(`/sites/${site.id}`, {
      method: 'DELETE',
      json: { confirm: site.domain, password: 'correct horse battery staple' },
    })
    expect(await server.rows('SELECT id FROM annotations')).toEqual([])
  })
})

describe('POST /v1/annotations', () => {
  const send = (key: string | null, json: unknown) =>
    server.request('/v1/annotations', {
      method: 'POST',
      headers: key ? { authorization: `Bearer ${key}` } : {},
      body: JSON.stringify(json),
    })

  it('lets a deploy script mark the chart with the site API key', async () => {
    const { site, apiKey } = await server.createSite()
    const response = await send(apiKey, { text: 'Deployed v2', ts: '2026-03-03' })
    expect(response.status).toBe(201)
    expect(((await response.json()) as { ok: boolean; note: Annotation }).note).toMatchObject({
      text: 'Deployed v2',
      ts: DAY_ONE,
    })
    expect((await series(site.id)).find((p) => p.notes)?.notes?.[0]?.text).toBe('Deployed v2')
  })

  it('refuses a missing or wrong key, and bad bodies', async () => {
    const { apiKey } = await server.createSite()
    expect((await send(null, { text: 'x' })).status).toBe(401)
    expect((await send('ak_wrong', { text: 'x' })).status).toBe(401)
    expect((await send(apiKey, { text: 'x'.repeat(201) })).status).toBe(400)
    expect((await send(apiKey, [])).status).toBe(400)
    const notJson = await server.request('/v1/annotations', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}` },
      body: 'nope',
    })
    expect(notJson.status).toBe(400)
  })
})
