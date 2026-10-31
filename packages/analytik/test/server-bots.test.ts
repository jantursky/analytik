import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DAY, HOUR } from '../src/shared/time'
import { classifyCrawler } from '../src/shared/ua'
import type { BotStats, Overview, Site } from '../src/shared/types'
import { CHROME, START, type TestServer, testServer } from './helpers/server'

const GPT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot'
const CHATGPT = 'Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)'
const GOOGLE = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'

describe('classifyCrawler', () => {
  it('names known crawlers and their category', () => {
    expect(classifyCrawler(GPT)).toEqual({ name: 'GPTBot', category: 'training' })
    expect(classifyCrawler(CHATGPT)).toEqual({ name: 'ChatGPT-User', category: 'answers' })
    expect(classifyCrawler(GOOGLE)).toEqual({ name: 'Googlebot', category: 'indexing' })
    expect(classifyCrawler('Mozilla/5.0 (Applebot-Extended/0.1)')).toEqual({
      name: 'Applebot-Extended',
      category: 'training',
    })
  })

  it('files unknown bots under Other bot and skips browsers', () => {
    expect(classifyCrawler('SomeNewCrawler/1.0 (+https://x.test/bot)')).toEqual({
      name: 'Other bot',
      category: 'indexing',
    })
    expect(classifyCrawler(CHROME)).toBeNull()
    expect(classifyCrawler('')).toBeNull()
    expect(classifyCrawler(null)).toBeNull()
  })
})

let server: TestServer
let site: Site
let apiKey: string

beforeEach(async () => {
  server = await testServer()
  ;({ site, apiKey } = await server.createSite())
})

afterEach(async () => {
  await server.close()
})

const report = (body: unknown, key = apiKey) =>
  server.request('/v1/bots', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}` },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

const stats = (query = '') => server.adminJson<BotStats>(`/sites/${site.id}/bots?from=2026-03-01&to=2026-03-31${query}`)

describe('POST /v1/bots', () => {
  it('records crawlers, skips browsers and keeps only the path', async () => {
    const response = await report({
      requests: [
        { userAgent: GPT, path: '/blog/a?utm=1#top' },
        { userAgent: CHATGPT, path: 'https://example.com/pricing?x=1' },
        { userAgent: CHROME, path: '/' },
        { userAgent: GOOGLE },
      ],
    })
    expect(await response.json()).toEqual({ ok: true, recorded: 2, skipped: 2 })
    const rows = await server.rows('SELECT crawler, category, path FROM bot_requests ORDER BY crawler')
    expect(rows).toEqual([
      { crawler: 'ChatGPT-User', category: 'answers', path: '/pricing' },
      { crawler: 'GPTBot', category: 'training', path: '/blog/a' },
    ])
    const columns = Object.keys((await server.rows('SELECT * FROM bot_requests'))[0] ?? {})
    expect(columns).toEqual(['site_id', 'ts', 'crawler', 'category', 'path'])
  })

  it('clamps timestamps to now and to the retention window', async () => {
    await server.admin(`/sites/${site.id}`, { method: 'PATCH', json: { retentionDays: 7 } })
    await report({
      requests: [
        { userAgent: GPT, path: '/future', ts: START + DAY },
        { userAgent: GPT, path: '/old', ts: START - 30 * DAY },
        { userAgent: GPT, path: '/ok', ts: START - HOUR },
      ],
    })
    const rows = await server.rows<{ path: string; ts: number }>('SELECT path, ts FROM bot_requests ORDER BY path')
    expect(rows).toEqual([
      { path: '/future', ts: START },
      { path: '/ok', ts: START - HOUR },
      { path: '/old', ts: START - 7 * DAY },
    ])
  })

  it('rejects a wrong key, bad bodies and oversized batches', async () => {
    expect((await report({ requests: [] }, 'nope')).status).toBe(401)
    expect((await report('{')).status).toBe(400)
    expect((await report({ requests: [] })).status).toBe(400)
    expect((await report({})).status).toBe(400)
    const many = Array.from({ length: 501 }, () => ({ userAgent: GPT, path: '/' }))
    expect((await report({ requests: many })).status).toBe(400)
    expect(await server.rows('SELECT * FROM bot_requests')).toEqual([])
  })

  it('splits large batches into several statements', async () => {
    const many = Array.from({ length: 250 }, (_, index) => ({ userAgent: GPT, path: `/p${index}` }))
    expect(await (await report({ requests: many })).json()).toMatchObject({ recorded: 250 })
    expect((await stats()).total).toBe(250)
  })
})

describe('bot stats', () => {
  beforeEach(async () => {
    const at = (day: number) => Date.UTC(2026, 2, day, 10)
    await report({
      requests: [
        { userAgent: GPT, path: '/blog/a', ts: at(10) },
        { userAgent: GPT, path: '/blog/b', ts: at(10) },
        { userAgent: CHATGPT, path: '/blog/a', ts: at(11) },
        { userAgent: GOOGLE, path: '/', ts: at(12) },
        { userAgent: 'Weird_Crawler/1.0 bot', path: '/x_y%', ts: at(12) },
      ],
    })
  })

  it('totals, groups and orders', async () => {
    const result = await stats()
    expect(result.total).toBe(5)
    expect(result.hasData).toBe(true)
    expect(result.crawlers[0]).toEqual({ key: 'GPTBot', category: 'training', requests: 2 })
    expect(result.categories.map((row) => [row.key, row.requests])).toEqual([
      ['training', 2],
      ['indexing', 2],
      ['answers', 1],
    ])
    expect(result.pages[0]).toEqual({ key: '/blog/a', requests: 2 })
    expect(result.recent.map((row) => row.path)).toEqual(['/', '/x_y%', '/blog/a', '/blog/a', '/blog/b'].slice(0, 5))
    expect(result.series.reduce((sum, point) => sum + point.requests, 0)).toBe(5)
    expect(result.series.length).toBeGreaterThan(20)
  })

  it('filters by several crawlers, categories and wildcard pages', async () => {
    expect((await stats('&crawler=GPTBot&crawler=Googlebot')).total).toBe(3)
    expect((await stats('&category=answers')).total).toBe(1)
    expect((await stats('&page=/blog/*')).total).toBe(3)
    expect((await stats('&page=/blog/*&crawler=GPTBot')).total).toBe(2)
    expect((await stats('&page=/x_y%25')).total).toBe(1)
    const filtered = await stats('&crawler=GPTBot')
    expect(filtered.series.reduce((sum, point) => sum + point.requests, 0)).toBe(2)
  })

  it('rejects an unknown category', async () => {
    expect((await server.admin(`/sites/${site.id}/bots?category=nope`)).status).toBe(400)
  })

  it('stays out of the human numbers', async () => {
    const overview = await server.adminJson<Overview>(`/sites/${site.id}/overview?from=2026-03-01&to=2026-03-31`)
    expect(overview.visitors.value).toBe(0)
    expect(overview.revenue.value).toBe(0)
    expect(await server.rows('SELECT * FROM sessions')).toEqual([])
  })

  it('is available through the stats API, share links, retention and site deletion', async () => {
    const range = { from: Date.UTC(2026, 2, 1), to: Date.UTC(2026, 2, 31) }
    expect((await server.analytik.stats.bots(site.id, range, { crawler: ['GPTBot'] })).total).toBe(2)
    expect((await server.analytik.stats.bots(site.id, range)).total).toBe(5)

    await server.analytik.stats.purge(site.id, Date.UTC(2026, 2, 12))
    expect((await stats()).total).toBe(2)

    const share = await server.adminJson<{ site: Site }>(`/sites/${site.id}`, {
      method: 'PATCH',
      json: { shareToken: true },
    })
    expect(share).toBeTruthy()
    await server.admin(`/sites/${site.id}`, {
      method: 'DELETE',
      json: { confirm: site.domain, password: 'correct horse battery staple' },
    })
    expect(await server.rows('SELECT * FROM bot_requests')).toEqual([])
  })
})
