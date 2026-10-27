import { afterEach, beforeEach, vi } from 'vitest'

import type { TrackerPayload } from '../src/shared/types'

export interface Sent {
  url: string
  beacon: boolean
  body: TrackerPayload
}

interface Captured {
  url: string
  beacon: boolean
  text: Promise<string>
}

/**
 * Captures what the tracker puts on the wire (fetch and sendBeacon) in happy-dom, and resets the page state
 * (URL, storage, cookies, visibility) around each test.
 */
export function captureWire(url = 'https://example.com/start') {
  const captured: Captured[] = []
  const responses = new Map<string, () => Response>()

  beforeEach(() => {
    ;(window as unknown as { happyDOM: { setURL: (href: string) => void } }).happyDOM.setURL(url)
    localStorage.clear()
    sessionStorage.clear()
    for (const cookie of document.cookie.split('; ')) {
      const name = cookie.split('=')[0]
      if (name) document.cookie = `${name}=; path=/; max-age=-1`
    }
    setVisibility('visible')
    Object.defineProperty(navigator, 'webdriver', { configurable: true, value: false })
    Object.defineProperty(document, 'referrer', { configurable: true, value: '' })
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string, init: RequestInit) => {
        captured.push({ url: input, beacon: false, text: Promise.resolve(init.body as string) })
        const respond = [...responses].find(([suffix]) => input.endsWith(suffix))?.[1]
        return Promise.resolve(respond ? respond() : new Response(null, { status: 202 }))
      }),
    )
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      value: (target: string, data: Blob) => {
        captured.push({ url: target, beacon: true, text: data.text() })
        return true
      },
    })
  })

  afterEach(() => {
    captured.length = 0
    responses.clear()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  return {
    /** Everything sent so far, parsed. */
    async sent(): Promise<Sent[]> {
      return Promise.all(
        captured.map(async (c) => ({ url: c.url, beacon: c.beacon, body: JSON.parse(await c.text) as TrackerPayload })),
      )
    },
    async types(): Promise<string[]> {
      return (await this.sent()).map((s) => s.body.t)
    },
    respond(suffix: string, respond: () => Response): void {
      responses.set(suffix, respond)
    },
    clear(): void {
      captured.length = 0
    },
  }
}

export function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
}

export function hide(): void {
  setVisibility('hidden')
  document.dispatchEvent(new Event('visibilitychange'))
}

export function show(): void {
  setVisibility('visible')
  document.dispatchEvent(new Event('visibilitychange'))
}

/** Lets pending promise callbacks settle; works with fake timers. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}
