import { createEngine, noopEngine } from '../tracker/engine'
import type { AnalytikClient, AnalytikOptions } from '../tracker/types'

export type { Analytik, AnalytikClient, AnalytikOptions, IdentifyInput, RevenueOptions } from '../tracker/types'
export type { AttributionIds, PrivacyMode, Props } from '../shared/types'

/**
 * The tracker as an ES module. Without `window` (SSR, workers) every method is a no-op and `attribution()`
 * resolves to `null`.
 */
export function createClient(options: AnalytikOptions): AnalytikClient {
  if (typeof window === 'undefined') return noopEngine
  return createEngine(options)
}
