import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Vitals } from '../src/shared/types'
import { createEngine } from '../src/tracker/engine'
import type { AnalytikClient, AnalytikOptions } from '../src/tracker/types'
import { captureWire, hide, show } from './tracker-harness'

const SRC = 'https://stats.example.net/js/analytik-vitals.js'
const wire = captureWire('https://example.com/start')
let engine: AnalytikClient | undefined

// The measuring script is only added to the page here, not fetched.
beforeAll(() => {
  ;(
    window as unknown as { happyDOM: { settings: Record<string, boolean> } }
  ).happyDOM.settings.handleDisabledFileLoadingAsSuccess = true
})
const global = window as Window & { analytikVitals?: () => Vitals }

function start(options: Partial<AnalytikOptions> = {}): AnalytikClient {
  engine = createEngine({
    site: 'site_1',
    api: 'https://stats.example.net/api',
    requireInteraction: false,
    vitalsSrc: SRC,
    ...options,
  })
  return engine
}

const loaded = (): string[] => [...document.head.querySelectorAll('script')].map((s) => s.src)
const pings = async () => (await wire.sent()).filter((s) => s.body.t === 'ping')

afterEach(() => {
  engine?.destroy()
  engine = undefined
  delete global.analytikVitals
  for (const script of document.head.querySelectorAll('script')) script.remove()
  vi.restoreAllMocks()
})

describe('the tracker and Core Web Vitals', () => {
  it('loads no measuring code and adds nothing to the ping unless the site asks for it', async () => {
    vi.useFakeTimers()
    global.analytikVitals = () => ({ l: 1000 })
    start()
    start({ vitals: 0 })
    vi.advanceTimersByTime(3000)
    hide()
    expect(loaded()).not.toContain(SRC)
    const [ping] = await pings()
    expect(ping?.body.v).toBeUndefined()
  })

  it('loads the script for a sampled page view only', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    start({ vitals: 10 })
    expect(loaded()).not.toContain(SRC)
    engine?.destroy()
    vi.spyOn(Math, 'random').mockReturnValue(0.05)
    start({ vitals: 10 })
    expect(loaded()).toEqual([SRC])
  })

  it('never loads it without an address for the script', () => {
    start({ vitals: 100, vitalsSrc: undefined })
    expect(loaded()).toEqual([])
  })

  it('sends the vitals once, with the update on leaving, and not with a timed update', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    start({ vitals: 100, pingInterval: 30 })
    global.analytikVitals = () => ({ l: 2100, i: 120, c: 0.05 })
    vi.advanceTimersByTime(30_000)
    expect((await pings()).map((p) => p.body.v)).toEqual([undefined])
    hide()
    show()
    vi.advanceTimersByTime(2000)
    hide()
    const sent = await pings()
    expect(sent.filter((p) => p.body.v).map((p) => [p.beacon, p.body.v])).toEqual([
      [true, { l: 2100, i: 120, c: 0.05 }],
    ])
    // The timed update never carries them, and neither does the update on the next hide.
    expect(sent.filter((p) => !p.beacon).every((p) => !p.body.v)).toBe(true)
    expect(sent.length).toBeGreaterThan(2)
  })

  it('waits for the script and for something measured before it gives up on a page view', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    start({ vitals: 100 })
    vi.advanceTimersByTime(2000)
    hide()
    show()
    global.analytikVitals = () => ({})
    vi.advanceTimersByTime(2000)
    hide()
    show()
    global.analytikVitals = () => ({ c: 0 })
    vi.advanceTimersByTime(2000)
    hide()
    // An empty answer is not a report; the first answer with a value is, and only that one.
    expect((await pings()).flatMap((p) => (p.body.v ? [p.body.v] : []))).toEqual([{ c: 0 }])
  })
})
