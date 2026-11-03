import type { VitalMetric } from './types'

export type VitalRating = 'good' | 'needs-work' | 'poor'

/** Google's thresholds: up to `good` is good, above `poor` is poor, in between needs work. */
export const VITAL_THRESHOLDS: Record<VitalMetric, { good: number; poor: number }> = {
  lcp: { good: 2500, poor: 4000 },
  inp: { good: 200, poor: 500 },
  cls: { good: 0.1, poor: 0.25 },
}

export function rateVital(metric: VitalMetric, value: number): VitalRating {
  const { good, poor } = VITAL_THRESHOLDS[metric]
  return value <= good ? 'good' : value > poor ? 'poor' : 'needs-work'
}
