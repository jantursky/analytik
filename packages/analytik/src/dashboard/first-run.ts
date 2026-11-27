import type { Overview } from '../shared/types'

/**
 * Whether a site has never received an event, from its overview over all time. Only an all-time read can tell it
 * from a site that is just quiet in the chosen range; a payment counts as activity too.
 */
export const neverHadEvents = (allTime: Overview): boolean =>
  allTime.visitors.value === 0 && allTime.pageviews.value === 0 && allTime.orders.value === 0
