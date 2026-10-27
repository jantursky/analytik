import type { Analytik, AnalytikClient } from '../tracker/types'

export interface DeferredAnalytik extends Analytik {
  /** Routes calls to `client` (queued ones first) until the returned cleanup detaches and destroys it. */
  attach(client: AnalytikClient): () => void
}

/**
 * A stable stand-in for a client created in an effect. Child effects run before the provider's, so their calls
 * are queued until the client exists.
 */
export function createDeferred(): DeferredAnalytik {
  let current: Analytik | null = null
  const queue: ((client: Analytik) => void)[] = []
  const run = (fn: (client: Analytik) => void): void => {
    if (current) fn(current)
    else queue.push(fn)
  }
  return {
    track: (...args) => run((c) => c.track(...args)),
    revenue: (...args) => run((c) => c.revenue(...args)),
    identify: (...args) => run((c) => c.identify(...args)),
    pageview: () => run((c) => c.pageview()),
    attribution: () => new Promise((resolve) => run((c) => resolve(c.attribution()))),
    consent: () => run((c) => c.consent()),
    withdrawConsent: () => run((c) => c.withdrawConsent()),
    optOut: () => run((c) => c.optOut()),
    optIn: () => run((c) => c.optIn()),
    attach(client) {
      current = client
      for (const fn of queue.splice(0)) fn(client)
      return () => {
        current = null
        client.destroy()
      }
    },
  }
}
