import { afterEach, describe, expect, it, vi } from 'vitest'

import { createEngine } from '../src/tracker/engine'
import type { AnalytikClient, AnalytikOptions } from '../src/tracker/types'
import { hide, settle, show, captureWire } from './tracker-harness'

const wire = captureWire('https://example.com/start?email=a%40b.c&utm_source=news#hash')
let engine: AnalytikClient | undefined

function start(options: Partial<AnalytikOptions> = {}): AnalytikClient {
  engine = createEngine({
    site: 'site_1',
    api: 'https://stats.example.net/api/',
    requireInteraction: false,
    ...options,
  })
  return engine
}

afterEach(() => {
  engine?.destroy()
  engine = undefined
  Object.defineProperty(navigator, 'doNotTrack', { configurable: true, value: null })
  Object.defineProperty(navigator, 'webdriver', { configurable: true, value: false })
  Reflect.deleteProperty(navigator, 'globalPrivacyControl')
})

describe('pageviews', () => {
  it('sends a strict pageview without ids, private params or fragment', async () => {
    Object.defineProperty(document, 'referrer', { configurable: true, value: 'https://news.example.org/a?x=1' })
    start()
    const [first] = await wire.sent()
    expect(first).toEqual({
      url: 'https://stats.example.net/api/event',
      beacon: false,
      body: {
        w: 'site_1',
        t: 'pageview',
        u: 'https://example.com/start?utm_source=news',
        r: 'https://news.example.org/a',
        sw: screen.width,
        m: 'strict',
      },
    })
    expect(vi.mocked(fetch).mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      keepalive: true,
      credentials: 'omit',
      headers: { 'Content-Type': 'text/plain' },
    })
    expect(document.cookie).toBe('')
    expect(localStorage.length + sessionStorage.length).toBe(0)
  })

  it('tracks History API navigation once per URL and without referrer', async () => {
    start({ keepQuery: ['tab'] })
    history.pushState({}, '', '/pricing?tab=team&secret=1')
    history.replaceState({}, '', '/pricing?tab=team#faq')
    history.pushState({}, '', '/docs')
    window.dispatchEvent(new PopStateEvent('popstate'))
    const pages = (await wire.sent()).map((s) => [s.body.u, s.body.r])
    expect(pages).toEqual([
      ['https://example.com/start?utm_source=news', undefined],
      ['https://example.com/pricing?tab=team', undefined],
      ['https://example.com/docs', undefined],
    ])
  })

  it('does not count a page again when the app strips its campaign keys with replaceState', async () => {
    start({ keepQuery: ['plan'] })
    history.replaceState({}, '', '/start')
    history.pushState({}, '', '/pricing?plan=pro&ref=launch&source=x')
    history.replaceState({}, '', '/pricing?plan=pro')
    history.pushState({}, '', '/pricing?plan=team')
    expect((await wire.sent()).map((s) => s.body.u)).toEqual([
      'https://example.com/start?utm_source=news',
      'https://example.com/pricing?plan=pro&ref=launch&source=x',
      'https://example.com/pricing?plan=team',
    ])
  })

  it('records pageview() only for a new URL and can skip automatic pageviews', async () => {
    const e = start({ autoPageviews: false })
    expect(await wire.sent()).toEqual([])
    e.pageview()
    e.pageview()
    expect(await wire.types()).toEqual(['pageview'])
  })

  it('reads the api default', async () => {
    start({ api: undefined })
    expect((await wire.sent())[0]?.url).toBe('/api/event')
  })
})

describe('requireInteraction', () => {
  it('waits for the first interaction and keeps queued events in order', async () => {
    const e = start({ requireInteraction: true })
    e.track('early')
    expect(await wire.sent()).toEqual([])
    window.dispatchEvent(new Event('pointerdown'))
    expect(await wire.types()).toEqual(['pageview', 'goal'])
    window.dispatchEvent(new Event('keydown'))
    expect(await wire.types()).toHaveLength(2)
  })

  it('opens after 3 s of visibility, restarting when the tab is hidden', async () => {
    vi.useFakeTimers()
    start({ requireInteraction: true })
    vi.advanceTimersByTime(2000)
    hide()
    vi.advanceTimersByTime(5000)
    expect(await wire.sent()).toEqual([])
    show()
    vi.advanceTimersByTime(2999)
    expect(await wire.sent()).toEqual([])
    vi.advanceTimersByTime(1)
    expect(await wire.types()).toEqual(['pageview'])
  })

  it('keeps the URL of each pageview made before the gate opened', async () => {
    start({ requireInteraction: true })
    history.pushState({}, '', '/second')
    window.dispatchEvent(new Event('scroll'))
    expect((await wire.sent()).map((s) => s.body.u)).toEqual([
      'https://example.com/start?utm_source=news',
      'https://example.com/second',
    ])
  })
})

describe('engaged time', () => {
  it('sends visible time as a beacon ping when the tab is hidden, attributed to the page', async () => {
    vi.useFakeTimers()
    start()
    vi.advanceTimersByTime(4200)
    hide()
    vi.advanceTimersByTime(10000)
    show()
    vi.advanceTimersByTime(1500)
    window.dispatchEvent(new Event('pagehide'))
    const pings = (await wire.sent()).filter((s) => s.body.t === 'ping')
    expect(pings.map((p) => [p.body.d, p.beacon, p.body.u])).toEqual([
      [4200, true, 'https://example.com/start?utm_source=news'],
      [1500, true, 'https://example.com/start?utm_source=news'],
    ])
  })

  it('pings every 4 minutes while visible, for half an hour per page', async () => {
    vi.useFakeTimers()
    start()
    vi.advanceTimersByTime(240_000 * 12)
    expect((await wire.types()).filter((t) => t === 'ping')).toHaveLength(8)
    history.pushState({}, '', '/next')
    vi.advanceTimersByTime(240_000)
    const sent = await wire.sent()
    expect(sent.at(-2)?.body).toMatchObject({ t: 'pageview', u: 'https://example.com/next' })
    expect(sent.at(-1)?.body).toMatchObject({ t: 'ping', d: 240_000, u: 'https://example.com/next' })
  })

  it('pings as often as pingInterval says, at least every 30 s, or only on leaving with 0', async () => {
    vi.useFakeTimers()
    start({ pingInterval: 60 })
    vi.advanceTimersByTime(60_000 * 35)
    expect((await wire.types()).filter((t) => t === 'ping')).toHaveLength(30)
    engine?.destroy()

    wire.clear()
    start({ pingInterval: 5 })
    vi.advanceTimersByTime(60_000)
    expect((await wire.types()).filter((t) => t === 'ping')).toHaveLength(2)
    engine?.destroy()

    wire.clear()
    start({ pingInterval: 0 })
    vi.advanceTimersByTime(600_000)
    expect((await wire.types()).filter((t) => t === 'ping')).toHaveLength(0)
    hide()
    const pings = (await wire.sent()).filter((s) => s.body.t === 'ping')
    expect(pings.map((p) => [p.body.d, p.beacon])).toEqual([[600_000, true]])
  })

  it('flushes the previous page before a navigation', async () => {
    vi.useFakeTimers()
    start()
    vi.advanceTimersByTime(2500)
    history.pushState({}, '', '/b')
    expect((await wire.sent()).map((s) => [s.body.t, s.body.u, s.body.d])).toEqual([
      ['pageview', 'https://example.com/start?utm_source=news', undefined],
      ['ping', 'https://example.com/start?utm_source=news', 2500],
      ['pageview', 'https://example.com/b', undefined],
    ])
  })
})

describe('clicks', () => {
  function click(html: string, selector: string, type = 'click'): void {
    document.body.innerHTML = html
    // happy-dom follows links; stay on the page.
    const stay = (event: Event): void => event.preventDefault()
    document.addEventListener(type, stay)
    document.querySelector(selector)?.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }))
    document.removeEventListener(type, stay)
  }

  it('tracks declarative goals with props from data-analytik-* attributes', async () => {
    start()
    wire.clear()
    click('<button data-analytik-event="signup" data-analytik-plan="pro"><span>Go</span></button>', 'span')
    click('<a href="#" data-analytik-event="trial" data-analytik-seats="3" data-other="x">Try</a>', 'a')
    const goals = (await wire.sent()).map((s) => [s.body.t, s.body.n, s.body.p, s.beacon])
    expect(goals).toEqual([
      ['goal', 'signup', { plan: 'pro' }, true],
      ['goal', 'trial', { seats: '3' }, true],
    ])
  })

  it('tracks outbound links by origin and path, also on middle click', async () => {
    start({ domain: 'example.com' })
    wire.clear()
    click('<a href="https://other.org/path?q=1#x">x</a>', 'a')
    click('<a href="https://other.org/b">x</a>', 'a', 'auxclick')
    click('<a href="https://docs.example.com/">x</a>', 'a')
    click('<a href="/internal">x</a>', 'a')
    click('<a href="mailto:a@b.c">x</a>', 'a')
    expect((await wire.sent()).map((s) => [s.body.t, s.body.n])).toEqual([
      ['outbound', 'https://other.org/path'],
      ['outbound', 'https://other.org/b'],
    ])
  })

  it('can turn off outbound and attribute tracking', async () => {
    start({ autoOutbound: false, autoTrackAttrs: false })
    wire.clear()
    click('<a href="https://other.org/" data-analytik-event="x">x</a>', 'a')
    expect(await wire.sent()).toEqual([])
  })

  it('adds the visitor to Dodo checkout links when ids are kept', () => {
    start({ mode: 'persistent', domain: 'example.com' })
    click('<a href="https://checkout.dodopayments.com/buy/p_1?quantity=1">Buy</a>', 'a')
    const href = new URL(document.querySelector('a')!.href)
    expect(href.searchParams.get('quantity')).toBe('1')
    expect(href.searchParams.get('metadata_analytik_visitor_id')).toMatch(/^[0-9a-f-]{36}$/)
    expect(href.searchParams.get('metadata_analytik_session_id')).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('leaves Dodo links alone in strict mode and ignores unparseable hrefs', () => {
    start()
    click('<a href="https://checkout.dodopayments.com/buy/p_1">Buy</a>', 'a')
    expect(document.querySelector('a')!.getAttribute('href')).toBe('https://checkout.dodopayments.com/buy/p_1')
    expect(() => click('<a href="http://[bad">x</a>', 'a')).not.toThrow()
  })
})

describe('api', () => {
  it('tracks goals, clipping names and props', async () => {
    const e = start()
    wire.clear()
    e.track('n'.repeat(80), { plan: 'pro', bad: {} as unknown as string })
    e.track('')
    expect((await wire.sent()).map((s) => s.body)).toMatchObject([{ t: 'goal', n: 'n'.repeat(64), p: { plan: 'pro' } }])
  })

  it('sends revenue in major units with currency, order id and props, and rejects bad amounts', async () => {
    const e = start()
    wire.clear()
    e.revenue('purchase', 49.9, { currency: 'eur', orderId: '1042', plan: 'pro' })
    e.revenue('', 10)
    e.revenue('bad', -1)
    e.revenue('bad', Number.NaN)
    expect((await wire.sent()).map((s) => s.body)).toMatchObject([
      { t: 'revenue', n: 'purchase', a: 49.9, c: 'EUR', o: '1042', p: { plan: 'pro' } },
      { t: 'revenue', n: 'revenue', a: 10 },
    ])
  })

  it('ignores identify in strict mode until consent', async () => {
    const e = start()
    wire.clear()
    e.identify({ userId: 'u1', email: 'a@b.c' })
    expect(await wire.sent()).toEqual([])
    e.consent()
    e.identify({ userId: 'u2', name: 'Ann' })
    e.identify({ email: 'c@d.e' })
    expect((await wire.sent()).map((s) => s.body.p)).toEqual([{ user_id: 'u2', name: 'Ann' }, { email: 'c@d.e' }])
    expect(document.cookie).toBe('')
  })

  it('opts out and back in, also through ?analytik_ignore', async () => {
    const e = start()
    e.optOut()
    wire.clear()
    e.track('x')
    expect(await e.attribution()).toBeNull()
    expect(await wire.sent()).toEqual([])
    e.optIn()
    e.track('y')
    expect(await wire.types()).toEqual(['goal'])
    e.destroy()

    ;(window as unknown as { happyDOM: { setURL: (u: string) => void } }).happyDOM.setURL(
      'https://example.com/?analytik_ignore=true',
    )
    start()
    expect(localStorage.getItem('analytik_ignore')).toBe('1')
    engine?.destroy()
    ;(window as unknown as { happyDOM: { setURL: (u: string) => void } }).happyDOM.setURL(
      'https://example.com/?analytik_ignore=false',
    )
    start()
    expect(localStorage.getItem('analytik_ignore')).toBeNull()
  })
})

describe('modes', () => {
  it('enriched: no ids before consent, a tab id after, gone after withdrawal', async () => {
    const e = start({ mode: 'enriched' })
    e.consent()
    e.track('a')
    e.withdrawConsent()
    e.track('b')
    const [pageview, a, b] = (await wire.sent()).map((s) => s.body)
    expect(pageview).toMatchObject({ m: 'strict' })
    expect(pageview?.sid).toBeUndefined()
    expect(a).toMatchObject({ m: 'enriched', sid: expect.stringMatching(/^[0-9a-f-]{36}$/) as string })
    expect(a?.vid).toBeUndefined()
    expect(b).toMatchObject({ m: 'strict' })
    expect(sessionStorage.getItem('analytik_tab')).toBeNull()
    expect(document.cookie).toBe('')
  })

  it('enriched: a tab id from an earlier consent counts as consent', async () => {
    sessionStorage.setItem('analytik_tab', 'tab-1')
    start({ mode: 'enriched' })
    expect((await wire.sent())[0]?.body).toMatchObject({ m: 'enriched', sid: 'tab-1' })
  })

  it('persistent: first-party cookies, reused across loads', async () => {
    start({ mode: 'persistent', domain: 'example.com' })
    const first = (await wire.sent())[0]?.body
    expect(first).toMatchObject({ m: 'persistent' })
    expect(document.cookie).toContain(`analytik_vid=${first?.vid}`)
    expect(document.cookie).toContain(`analytik_sid=${first?.sid}`)
    expect(await engine?.attribution()).toEqual({ analytik_visitor_id: first?.vid, analytik_session_id: first?.sid })
    engine?.destroy()
    wire.clear()
    start({ mode: 'persistent', domain: 'example.com' })
    expect((await wire.sent())[0]?.body.vid).toBe(first?.vid)
  })

  it('persistent: withdrawing consent deletes the cookies and is remembered', async () => {
    const e = start({ mode: 'persistent', domain: 'example.com' })
    e.withdrawConsent()
    expect(document.cookie).not.toContain('analytik_vid=')
    expect(localStorage.getItem('analytik_consent')).toBe('0')
    e.destroy()
    wire.clear()
    const next = start({ mode: 'persistent', domain: 'example.com' })
    expect((await wire.sent())[0]?.body).toMatchObject({ m: 'strict' })
    next.consent()
    expect(localStorage.getItem('analytik_consent')).toBe('1')
    next.track('x')
    expect((await wire.sent())[1]?.body).toMatchObject({ m: 'persistent' })
  })

  it('persistent: Do Not Track and Global Privacy Control fall back to strict unless consent is given', async () => {
    Object.defineProperty(navigator, 'doNotTrack', { configurable: true, value: '1' })
    const e = start({ mode: 'persistent', domain: 'example.com' })
    expect((await wire.sent())[0]?.body).toMatchObject({ m: 'strict' })
    e.destroy()
    Object.defineProperty(navigator, 'doNotTrack', { configurable: true, value: null })
    Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, value: true })
    wire.clear()
    const gpc = start({ mode: 'persistent', domain: 'example.com' })
    gpc.track('a')
    gpc.consent()
    gpc.track('b')
    expect((await wire.sent()).map((s) => s.body.m)).toEqual(['strict', 'strict', 'persistent'])
  })

  it('persistent: optOut deletes the cookies; unknown modes are strict', async () => {
    const e = start({ mode: 'persistent', domain: 'example.com' })
    e.optOut()
    expect(document.cookie).not.toContain('analytik_vid=')
    e.destroy()
    localStorage.clear()
    wire.clear()
    start({ mode: 'bogus' as never })
    expect((await wire.sent())[0]?.body.m).toBe('strict')
  })

  it('persistent: finds the widest cookie domain itself', () => {
    start({ mode: 'persistent' })
    expect(document.cookie).toContain('analytik_vid=')
  })
})

describe('attribution', () => {
  it('asks the server in strict mode', async () => {
    wire.respond('/attribution', () => Response.json({ visitorId: 'v1', sessionId: 's1' }))
    const e = start()
    expect(await e.attribution()).toEqual({ analytik_visitor_id: 'v1', analytik_session_id: 's1' })
    const request = vi.mocked(fetch).mock.calls.find(([url]) => url === 'https://stats.example.net/api/attribution')
    expect(JSON.parse(request?.[1]?.body as string)).toEqual({
      w: 'site_1',
      u: 'https://example.com/start?utm_source=news',
      m: 'strict',
    })
  })

  it('resolves null when the server fails or answers without ids', async () => {
    const e = start()
    wire.respond('/attribution', () => new Response('nope', { status: 429 }))
    expect(await e.attribution()).toBeNull()
    wire.respond('/attribution', () => Response.json({}))
    expect(await e.attribution()).toBeNull()
  })
})

describe('guards and transport', () => {
  it('does nothing without a site, in automated browsers and on localhost', async () => {
    const debug = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    start({ site: '', debug: true }).track('x')
    Object.defineProperty(navigator, 'webdriver', { configurable: true, value: true })
    start({ debug: true })
    Object.defineProperty(navigator, 'webdriver', { configurable: true, value: false })
    ;(window as unknown as { happyDOM: { setURL: (u: string) => void } }).happyDOM.setURL('http://localhost:5173/')
    const local = start({ debug: true })
    expect(await local.attribution()).toBeNull()
    expect(await wire.sent()).toEqual([])
    expect(debug.mock.calls.map((c): unknown => c[2])).toEqual([
      'no site id',
      'automated browser',
      'localhost (allow with data-allow-localhost)',
    ])
    start({ allowLocalhost: true })
    expect(await wire.types()).toEqual(['pageview'])
  })

  it('logs what it sends in debug mode', async () => {
    const debug = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const e = start({ debug: true })
    e.revenue('x', 0)
    e.optOut()
    e.track('y')
    await settle()
    expect(debug.mock.calls.map((c): unknown[] => c.slice(0, 2))).toEqual([
      ['[analytik]', 'pageview'],
      ['[analytik]', 'revenue ignored, amount must be a positive number:'],
      ['[analytik]', 'opted out, not sent:'],
    ])
  })

  it('falls back to fetch when sendBeacon is missing or refuses, and survives fetch failures', async () => {
    const e = start()
    wire.clear()
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: undefined })
    e.track('a')
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: () => false })
    e.track('b')
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'))
    e.track('c')
    await settle()
    expect((await wire.sent()).map((s) => [s.body.n, s.beacon])).toEqual([
      ['a', false],
      ['b', false],
    ])
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(4) // with the pageview
  })

  it('stops listening after destroy', async () => {
    const e = start()
    e.destroy()
    wire.clear()
    history.pushState({}, '', '/after')
    document.body.innerHTML = '<a href="https://other.org/">x</a>'
    document.addEventListener('click', (event) => event.preventDefault(), { once: true })
    document.querySelector('a')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(await wire.sent()).toEqual([])
  })

  it('keeps working when storage throws', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const e = start({ mode: 'enriched' })
    e.consent()
    e.track('a')
    e.track('b')
    const [, a, b] = (await wire.sent()).map((s) => s.body.sid)
    expect(a).toBeDefined()
    expect(b).toBe(a)
    getItem.mockRestore()
    setItem.mockRestore()
  })
})
