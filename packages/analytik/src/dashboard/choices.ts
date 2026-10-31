import type { Comparison } from '../shared/types'
import { type DateRange, presetRange, RANGE_PRESETS } from './range'

const PRESETS = RANGE_PRESETS.map((p) => p.value).filter((value) => value !== 'custom')
const INTERVALS = ['hour', 'day', 'week', 'month']

/** What the preferences remember of the date range: a preset ending now (never a custom range) and its interval. */
export function savedRange(values: Record<string, unknown>, now: number): DateRange | undefined {
  const { period, interval } = values
  if (typeof period !== 'string' || !(PRESETS as string[]).includes(period)) return undefined
  const range = presetRange(period as Exclude<DateRange['preset'], 'custom'>, now)
  return typeof interval === 'string' && INTERVALS.includes(interval)
    ? { ...range, interval: interval as DateRange['interval'] }
    : range
}

/** The remembered comparison, if it is one the dashboard knows. */
export function savedCompare(values: Record<string, unknown>): Comparison | undefined {
  return values.compare === 'previous' || values.compare === 'year' ? values.compare : undefined
}
