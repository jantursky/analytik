import type { Interval } from '../shared/types'
import { msg } from './i18n'

export type RangePreset = 'today' | '24h' | '7d' | '30d' | '90d' | '12m' | 'custom'

export interface DateRange {
  preset: RangePreset
  /** Unix milliseconds, inclusive. */
  from: number
  /** Unix milliseconds, exclusive. */
  to: number
  interval: Interval
}

const PRESET_LABELS: Record<RangePreset, string> = {
  today: msg('Today'),
  '24h': msg('Past 24 hours'),
  '7d': msg('Past 7 days'),
  '30d': msg('Past 30 days'),
  '90d': msg('Past 90 days'),
  '12m': msg('Past 12 months'),
  custom: msg('Custom'),
}

export const RANGE_PRESETS: { value: RangePreset; label: string }[] = (
  Object.entries(PRESET_LABELS) as [RangePreset, string][]
).map(([value, label]) => ({ value, label }))

const HOUR = 3600000
const DAY = 24 * HOUR

function startOfDay(ms: number, daysBack = 0): number {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - daysBack)
  return date.getTime()
}

/** Picks an interval that gives a readable number of buckets. */
export function intervalFor(from: number, to: number): Interval {
  const days = (to - from) / DAY
  return days <= 2 ? 'hour' : days <= 120 ? 'day' : days <= 400 ? 'week' : 'month'
}

/** The range a preset covers, ending now (local time). */
export function presetRange(preset: Exclude<RangePreset, 'custom'>, now: number): DateRange {
  const from = {
    today: startOfDay(now),
    '24h': now - DAY,
    '7d': startOfDay(now, 6),
    '30d': startOfDay(now, 29),
    '90d': startOfDay(now, 89),
    '12m': (() => {
      const date = new Date(startOfDay(now))
      date.setFullYear(date.getFullYear() - 1, date.getMonth(), 1)
      return date.getTime()
    })(),
  }[preset]
  return { preset, from, to: now, interval: preset === '12m' ? 'month' : intervalFor(from, now) }
}

/** A custom range from two `YYYY-MM-DD` dates, both days included. `null` when invalid or reversed. */
export function customRange(start: string, end: string): DateRange | null {
  const from = new Date(`${start}T00:00:00`).getTime()
  const last = new Date(`${end}T00:00:00`).getTime()
  if (!Number.isFinite(from) || !Number.isFinite(last) || last < from) return null
  const to = startOfDay(last + DAY + HOUR) // next local midnight, safe across DST changes
  return { preset: 'custom', from, to, interval: intervalFor(from, to) }
}

/** `YYYY-MM-DD` in local time, for date inputs. */
export function toDateInput(ms: number): string {
  const date = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** The intervals that give a readable number of buckets for a range. */
export function intervalsFor(from: number, to: number): Interval[] {
  const days = (to - from) / DAY
  const all: [Interval, boolean][] = [
    ['hour', days <= 14],
    ['day', days <= 400],
    ['week', days >= 14],
    ['month', days >= 60],
  ]
  return all.filter(([, ok]) => ok).map(([interval]) => interval)
}

/**
 * The period before (`-1`) or after (`1`) a range, as a custom range of the same length. Ranges that start at
 * midnight move by whole days, so "Today" steps to yesterday. `null` when the next period would start in the future.
 */
export function shiftRange(range: DateRange, step: -1 | 1, now: number): DateRange | null {
  const length = range.to - range.from
  const span = range.from === startOfDay(range.from) ? Math.ceil(length / DAY) * DAY : length
  const from = range.from + step * span
  if (from >= now) return null
  const to = Math.min(step < 0 ? range.from : range.from + 2 * span, now)
  return { preset: 'custom', from, to, interval: range.interval }
}
