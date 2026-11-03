/*! analytik vitals | MIT | loaded by analytik.js when a site turns on Core Web Vitals */
import type { Vitals } from '../shared/types'

type Entry = PerformanceEntry & {
  value?: number
  hadRecentInput?: boolean
  interactionId?: number
}

/** Calls `handle` with the entries of `type` seen so far and from now on; false when the browser lacks the type. */
function observe(type: string, handle: (entries: Entry[]) => void, extra: PerformanceObserverInit = {}): boolean {
  try {
    new PerformanceObserver((list) => handle(list.getEntries())).observe({
      type,
      buffered: true,
      ...extra,
    })
    return true
  } catch {
    return false
  }
}

/**
 * Starts measuring Largest Contentful Paint, Interaction to Next Paint and Cumulative Layout Shift, and returns what
 * is known right now: values for the metrics this browser can measure, nothing for the others. Hand-rolled rather
 * than the `web-vitals` library to stay small.
 */
export function measureVitals(): () => Vitals {
  let lcp: number | undefined
  const lcpSupported = observe('largest-contentful-paint', (entries) => {
    const last = entries.at(-1)
    if (last) lcp = last.startTime
  })

  // CLS is the worst burst of shifts: shifts less than a second apart, in a window of at most five seconds.
  let cls = 0
  let burst = 0
  let burstStart = 0
  let burstLast = 0
  const clsSupported = observe('layout-shift', (entries) => {
    for (const entry of entries) {
      if (entry.hadRecentInput) continue
      if (burst && entry.startTime - burstLast < 1000 && entry.startTime - burstStart < 5000) burst += entry.value ?? 0
      else {
        burst = entry.value ?? 0
        burstStart = entry.startTime
      }
      burstLast = entry.startTime
      cls = Math.max(cls, burst)
    }
  })

  // INP is close to the slowest interaction: the 98th percentile once a page has had 50 of them.
  const slowest = new Map<number, number>()
  const inpSupported = observe(
    'event',
    (entries) => {
      for (const entry of entries) {
        if (entry.interactionId)
          slowest.set(entry.interactionId, Math.max(slowest.get(entry.interactionId) ?? 0, entry.duration))
      }
    },
    { durationThreshold: 40 } as PerformanceObserverInit,
  )

  return () => {
    const times = [...slowest.values()].sort((a, b) => b - a)
    return {
      ...(lcpSupported && lcp !== undefined && { l: Math.round(lcp) }),
      ...(inpSupported && { i: Math.round(times[Math.min(times.length - 1, Math.floor(times.length / 50))] ?? 0) }),
      ...(clsSupported && { c: Math.round(cls * 1000) / 1000 }),
    }
  }
}

;(window as Window & { analytikVitals?: () => Vitals }).analytikVitals = measureVitals()
