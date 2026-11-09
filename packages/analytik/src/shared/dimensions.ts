import type { Dimension, FilterKey } from './types'

/** Every dimension a filter or breakdown can use. */
export const DIMENSIONS: readonly Dimension[] = [
  'channel',
  'source',
  'referrer',
  'campaign',
  'medium',
  'term',
  'content',
  'ref',
  'page',
  'entry',
  'exit',
  'country',
  'region',
  'city',
  'browser',
  'os',
  'device',
  'event',
  'outbound',
  'goal',
]

/** A property filter is written `prop:<key>`. */
export const PROP_PREFIX = 'prop:'

/** Keys of goal properties the report and the filter accept; anything else is ignored, never put into a query. */
export const PROP_KEY = /^[A-Za-z0-9_.-]{1,64}$/

export const isPropKey = (key: string): boolean => PROP_KEY.test(key)

/** Whether a filter key names a dimension or a valid property (`prop:plan`). */
export function isFilterKey(key: string): key is FilterKey {
  return (
    (DIMENSIONS as readonly string[]).includes(key) ||
    (key.startsWith(PROP_PREFIX) && isPropKey(key.slice(PROP_PREFIX.length)))
  )
}
