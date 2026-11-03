import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Vitals } from '../src/shared/types'

interface Entry {
  startTime?: number
  duration?: number
  value?: number
  hadRecentInput?: boolean
  interactionId?: number
}

/** A PerformanceObserver that lets a test deliver entries by type, and refuses the types a browser lacks. */
const observers = new Map<string, (entries: Entry[]) => void>()
const unsupported = new Set<string>()
const options = new Map<string, unknown>()

class FakeObserver {
  constructor(private readonly callback: (list: { getEntries: () => Entry[] }) => void) {}
  observe(init: { type: string }): void {
    if (unsupported.has(init.type)) throw new TypeError('unsupported entry type')
    options.set(init.type, init)
    observers.set(init.type, (entries) => this.callback({ getEntries: () => entries }))
  }
}

const emit = (type: string, ...entries: Entry[]): void => observers.get(type)?.(entries)

async function measure(): Promise<() => Vitals> {
  vi.resetModules()
  delete (window as Window & { analytikVitals?: unknown }).analytikVitals
  await import('../src/tracker/vitals')
  return (window as unknown as { analytikVitals: () => Vitals }).analytikVitals
}

beforeEach(() => {
  observers.clear()
  unsupported.clear()
  options.clear()
  vi.stubGlobal('PerformanceObserver', FakeObserver)
})
afterEach(() => vi.unstubAllGlobals())

describe('analytik-vitals.js', () => {
  it('reports nothing before anything was measured, apart from a clean layout and no slow interactions', async () => {
    const read = await measure()
    expect(read()).toEqual({ i: 0, c: 0 })
  })

  it('takes the latest largest contentful paint, rounded to a millisecond', async () => {
    const read = await measure()
    emit('largest-contentful-paint', { startTime: 900.4 })
    emit('largest-contentful-paint', { startTime: 1200.6 }, { startTime: 2100.2 })
    expect(read().l).toBe(2100)
  })

  it('scores layout shift as the worst burst, ignoring shifts right after an input', async () => {
    const read = await measure()
    emit('layout-shift', { startTime: 100, value: 0.05 }, { startTime: 600, value: 0.04 })
    // More than a second later: a new burst, smaller than the first one.
    emit('layout-shift', { startTime: 3000, value: 0.02 })
    emit('layout-shift', { startTime: 3100, value: 0.5, hadRecentInput: true })
    expect(read().c).toBe(0.09)
    // A burst that keeps going past five seconds starts a new one.
    emit(
      'layout-shift',
      { startTime: 3500, value: 0.01 },
      { startTime: 4400, value: 0.01 },
      { startTime: 5300, value: 0.01 },
    )
    expect(read().c).toBe(0.09)
    emit('layout-shift', { startTime: 9000, value: 0.2 })
    expect(read().c).toBe(0.2)
  })

  it('takes the slowest interaction as INP, and the 98th percentile after fifty of them', async () => {
    const read = await measure()
    emit(
      'event',
      { interactionId: 1, duration: 80 },
      { interactionId: 1, duration: 150 },
      { interactionId: 2, duration: 96.4 },
      { duration: 900 },
    )
    expect(read().i).toBe(150)
    emit('event', ...Array.from({ length: 60 }, (_, n) => ({ interactionId: 10 + n, duration: 50 + n })))
    // 62 interactions: the slowest (150) is skipped once, so the second slowest counts.
    expect(read().i).toBe(109)
    expect(options.get('event')).toMatchObject({ durationThreshold: 40, buffered: true })
  })

  it('leaves out the metrics a browser cannot measure', async () => {
    unsupported.add('layout-shift')
    unsupported.add('event')
    const read = await measure()
    expect(read()).toEqual({})
    emit('largest-contentful-paint', { startTime: 1500 })
    expect(read()).toEqual({ l: 1500 })
  })
})
