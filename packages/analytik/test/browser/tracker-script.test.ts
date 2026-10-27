import { afterEach, describe, expect, it } from 'vitest'

import type { AttributionIds, TrackerPayload } from '../../src/shared/types'
import type { AnalytikGlobal } from '../../src/tracker/types'

interface Received {
  path: string
  type: string
  body: TrackerPayload
}

type FrameWindow = Window & { analytik: AnalytikGlobal; history: History }

const frames: HTMLIFrameElement[] = []

afterEach(() => {
  for (const frame of frames.splice(0)) frame.remove()
})

/** Opens the fake site page in an iframe with the given script attributes. */
async function openPage(attrs: Record<string, string>, path = '') {
  const run = Math.random().toString(36).slice(2)
  const frame = document.createElement('iframe')
  frame.style.width = '800px'
  frame.style.height = '400px'
  // The test server runs on localhost.
  const query = new URLSearchParams({ attrs: JSON.stringify({ 'data-allow-localhost': '', ...attrs }) })
  frame.src = `/__analytik/page/${run}${path}?${query.toString()}&utm_source=test&email=a%40b.c#frag`
  const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }))
  document.body.appendChild(frame)
  frames.push(frame)
  await loaded
  const win = frame.contentWindow as FrameWindow
  await waitFor(() => typeof win.analytik === 'function', 'script installed')
  return { run, frame, win, doc: frame.contentDocument! }
}

async function waitFor(check: () => boolean | Promise<boolean>, what: string, timeout = 8000): Promise<void> {
  const end = Date.now() + timeout
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

async function received(run: string): Promise<Received[]> {
  const response = await fetch(`/__analytik/run/${run}/received`)
  return JSON.parse(await response.text()) as Received[]
}

/** Waits until at least `count` requests arrived, then returns them. */
async function collect(run: string, count: number): Promise<Received[]> {
  let list: Received[] = []
  await waitFor(async () => (list = await received(run)).length >= count, `${count} requests`)
  return list
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('tracker in a real browser', () => {
  it('sends a strict pageview as text/plain with a cleaned URL and no storage', async () => {
    const { run, win, doc } = await openPage({ 'data-site': 'site_1', 'data-require-interaction': 'false' })
    const [pageview] = await collect(run, 1)
    expect(pageview?.path).toBe('api/event')
    expect(pageview?.type).toMatch(/^text\/plain/)
    expect(pageview?.body).toMatchObject({ w: 'site_1', t: 'pageview', m: 'strict', sw: win.screen.width })
    const url = new URL(pageview!.body.u)
    expect(url.search).toBe('?utm_source=test')
    expect(url.hash).toBe('')
    expect(pageview?.body.vid).toBeUndefined()
    expect(doc.cookie).toBe('')
    expect(win.localStorage.length + win.sessionStorage.length).toBe(0)
  })

  it('tracks SPA navigation, goals, declarative attributes and outbound links', async () => {
    const { run, win, doc } = await openPage({ 'data-site': 'site_1', 'data-require-interaction': 'false' })
    await collect(run, 1)
    win.history.pushState({}, '', '/spa/next?token=secret&ref=hn')
    win.analytik.track('cta', { place: 'hero' })
    doc.getElementById('signup')!.click()
    doc.getElementById('trial')!.click()
    doc.getElementById('in')!.click()
    doc.getElementById('out')!.click()
    const all = await collect(run, 6)
    // The first page's view goes first; the rest are sent together, and the network may reorder them.
    const rows = all.map((r) => JSON.stringify([r.body.t, r.body.n, r.body.p]))
    expect(rows[0]).toBe(JSON.stringify(['pageview', undefined, undefined]))
    expect(rows.slice(1).sort()).toEqual(
      [
        ['pageview', undefined, undefined],
        ['goal', 'cta', { place: 'hero' }],
        ['goal', 'signup', { plan: 'pro' }],
        ['goal', 'trial', { seats: '3' }],
        ['outbound', 'https://outbound.example.org/docs', undefined],
      ]
        .map((row) => JSON.stringify(row))
        .sort(),
    )
    const spa = all.find((r) => r.body.t === 'pageview' && r !== all[0])
    expect(new URL(spa!.body.u).pathname + new URL(spa!.body.u).search).toBe('/spa/next?ref=hn')
  })

  it('waits for an interaction before the first pageview', async () => {
    const { run, win } = await openPage({ 'data-site': 'site_1' })
    win.analytik.track('before')
    await pause(600)
    expect(await received(run)).toEqual([])
    win.dispatchEvent(new Event('pointerdown'))
    expect((await collect(run, 2)).map((r) => r.body.t)).toEqual(['pageview', 'goal'])
  })

  it('sends engaged time as a beacon when the page goes away', async () => {
    const { run, frame } = await openPage({ 'data-site': 'site_1', 'data-require-interaction': 'false' })
    await collect(run, 1)
    await pause(1300)
    frame.src = 'about:blank'
    const [, ping] = await collect(run, 2)
    expect(ping?.body.t).toBe('ping')
    expect(ping?.body.d).toBeGreaterThanOrEqual(1000)
  })

  it('persistent mode: first-party cookies carry the ids, revenue goes out with them', async () => {
    const { run, win, doc } = await openPage({
      'data-site': 'site_2',
      'data-mode': 'persistent',
      'data-require-interaction': 'false',
    })
    const [pageview] = await collect(run, 1)
    expect(pageview?.body).toMatchObject({ w: 'site_2', m: 'persistent' })
    expect(doc.cookie).toContain(`analytik_vid=${pageview?.body.vid}`)
    expect(doc.cookie).toContain(`analytik_sid=${pageview?.body.sid}`)
    win.analytik('track', 'command_style')
    win.analytik.revenue('purchase', 49.9, { currency: 'eur', orderId: 'o1' })
    const [, goal, revenue] = await collect(run, 3)
    expect(goal?.body).toMatchObject({ t: 'goal', n: 'command_style', vid: pageview?.body.vid })
    expect(revenue?.body).toMatchObject({ t: 'revenue', a: 49.9, c: 'EUR', o: 'o1' })
  })

  it('asks the server for attribution ids in strict mode and honours opt-out', async () => {
    const { run, win } = await openPage({ 'data-site': 'site_1', 'data-require-interaction': 'false' })
    const ids: AttributionIds | null = await win.analytik.attribution()
    expect(ids).toEqual({ analytik_visitor_id: 'v_srv', analytik_session_id: 's_srv' })
    const requests = await collect(run, 2)
    expect(requests.find((r) => r.path === 'api/attribution')?.body).toMatchObject({ w: 'site_1', m: 'strict' })
    win.analytik.optOut()
    win.analytik.track('hidden')
    await pause(300)
    expect((await received(run)).some((r) => r.body.n === 'hidden')).toBe(false)
    win.analytik.optIn()
  })
})
