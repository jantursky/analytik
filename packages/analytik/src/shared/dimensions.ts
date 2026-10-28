import type { Dimension } from './types'

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
