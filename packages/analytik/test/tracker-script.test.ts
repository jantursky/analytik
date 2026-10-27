import { afterEach, describe, expect, it, vi } from 'vitest'

import type * as EngineModule from '../src/tracker/engine'
import type { AnalytikGlobal } from '../src/tracker/types'
import { captureWire } from './tracker-harness'

type Win = Window & {
  analytik?: AnalytikGlobal & { q?: unknown[][] }
}
const win = window as Win
const wire = captureWire('https://example.com/')
// The script installs for the page's lifetime; destroy each engine it creates between tests.
const engines = vi.hoisted(() => [] as { destroy: () => void }[])
vi.mock('../src/tracker/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof EngineModule>()
  return {
    ...actual,
    createEngine: (...args: Parameters<typeof actual.createEngine>) => {
      const engine = actual.createEngine(...args)
      engines.push(engine)
      return engine
    },
  }
})

/** Runs the script entry as if loaded from a tag with `attrs`. */
async function load(attrs: Record<string, string>, { current = true } = {}): Promise<void> {
  vi.resetModules()
  const script = document.createElement('script')
  for (const [name, value] of Object.entries(attrs)) script.setAttribute(name, value)
  if (current) Object.defineProperty(document, 'currentScript', { configurable: true, value: script })
  else document.head.appendChild(script)
  await import('../src/tracker/tracker')
}

afterEach(() => {
  for (const engine of engines.splice(0)) engine.destroy()
  Object.defineProperty(document, 'currentScript', { configurable: true, value: null })
  document.head.innerHTML = ''
  delete win.analytik
})

describe('script tag', () => {
  it('reads data-* attributes and posts to the script origin by default', async () => {
    await load({
      src: 'https://stats.example.net/analytik.js',
      'data-site': 'site_1',
      'data-require-interaction': 'false',
      'data-keep-query': 'page, tab',
    })
    window.history.pushState({}, '', '/list?page=2&tab=a&x=1')
    const sent = await wire.sent()
    expect(sent.map((s) => [s.url, s.body.u])).toEqual([
      ['https://stats.example.net/api/event', 'https://example.com/'],
      ['https://stats.example.net/api/event', 'https://example.com/list?page=2&tab=a'],
    ])
  })

  it('waits for interaction unless turned off, and honours data-auto-* flags', async () => {
    await load({
      src: '/analytik.js',
      'data-site': 'site_1',
      'data-auto-outbound': 'false',
      'data-auto-track-attrs': 'false',
    })
    expect(await wire.sent()).toEqual([])
    window.dispatchEvent(new Event('pointerdown'))
    document.body.innerHTML = '<a href="https://other.org/" data-analytik-event="x">x</a>'
    document.addEventListener('click', (e) => e.preventDefault(), { once: true })
    document.querySelector('a')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(await wire.types()).toEqual(['pageview'])
  })

  it('posts to data-api and reads the persistent mode and cookie domain', async () => {
    await load({
      'data-site': 'site_2',
      'data-api': 'https://collect.example.net/stats/',
      'data-require-interaction': 'false',
      'data-mode': 'persistent',
      'data-domain': 'example.com',
    })
    win.analytik?.('track', 'signup', { plan: 'pro' })
    const sent = await wire.sent()
    expect(sent.map((s) => [s.url, s.body.w, s.body.t, s.body.n, s.body.m])).toEqual([
      ['https://collect.example.net/stats/event', 'site_2', 'pageview', undefined, 'persistent'],
      ['https://collect.example.net/stats/event', 'site_2', 'goal', 'signup', 'persistent'],
    ])
    expect(await win.analytik?.attribution()).toEqual({
      analytik_visitor_id: sent[0]?.body.vid,
      analytik_session_id: sent[0]?.body.sid,
    })
  })

  it('replays queued calls and supports command and method calls', async () => {
    win.analytik = Object.assign(() => undefined, { q: [['track', 'queued', { a: 1 }]] }) as unknown as Win['analytik']
    await load({ 'data-site': 'site_1', 'data-require-interaction': 'false' })
    win.analytik?.('revenue', 'order', 5, { currency: 'USD' })
    win.analytik?.track('method')
    expect(win.analytik?.('nope' as never)).toBeUndefined()
    expect(win.analytik?.('destroy' as never)).toBeUndefined()
    expect((await wire.sent()).map((s) => [s.body.t, s.body.n])).toEqual([
      ['pageview', undefined],
      ['goal', 'queued'],
      ['revenue', 'order'],
      ['goal', 'method'],
    ])
  })

  it('sends nothing without data-site', async () => {
    await load({ src: '/analytik.js', 'data-require-interaction': 'false' })
    expect(await wire.sent()).toEqual([])
  })

  it('finds its tag without currentScript and does not install twice', async () => {
    await load({ 'data-site': 'site_1', 'data-require-interaction': 'false', 'data-debug': '' }, { current: false })
    const debug = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const first = win.analytik
    expect(first?.track).toBeTypeOf('function')
    await load({ 'data-site': 'other', 'data-require-interaction': 'false' }, { current: false })
    expect(win.analytik).toBe(first)
    expect((await wire.sent()).map((s) => [s.url, s.body.w])).toEqual([['/api/event', 'site_1']])
    first?.track('x')
    expect(debug).toHaveBeenCalledWith('[analytik]', 'goal', expect.objectContaining({ n: 'x' }))
  })

  it('stays inert without a tag', async () => {
    vi.resetModules()
    await import('../src/tracker/tracker')
    expect(win.analytik).toBeUndefined()
  })
})
