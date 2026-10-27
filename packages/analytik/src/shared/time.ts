import type { Interval } from './types'

export const MINUTE = 60_000
export const HOUR = 3_600_000
export const DAY = 86_400_000

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string): Intl.DateTimeFormat {
  let format = formatters.get(timeZone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
    formatters.set(timeZone, format)
  }
  return format
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone)
    return true
  } catch {
    return false
  }
}

interface WallClock {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

function wallClock(at: number, timeZone: string): WallClock {
  const parts: Record<string, number> = {}
  for (const part of formatter(timeZone).formatToParts(new Date(at))) parts[part.type] = Number(part.value)
  return {
    year: parts.year ?? 1970,
    month: parts.month ?? 1,
    day: parts.day ?? 1,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
  }
}

/** Offset of `timeZone` from UTC at the instant `at`, in ms (positive east of UTC). */
export function tzOffset(timeZone: string, at: number): number {
  const wall = wallClock(at, timeZone)
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute)
  return asUtc - Math.floor(at / MINUTE) * MINUTE
}

/** The instant at which the wall clock in `timeZone` shows the given local time. */
export function zonedTime(timeZone: string, year: number, month: number, day = 1, hour = 0): number {
  const local = Date.UTC(year, month - 1, day, hour)
  // Two passes settle the offset on both sides of a daylight saving change.
  const guess = local - tzOffset(timeZone, local)
  return local - tzOffset(timeZone, guess)
}

/** Start of the bucket (hour, day, ISO week starting Monday, month) that contains `at`, in `timeZone`. */
export function startOfBucket(at: number, interval: Interval, timeZone: string): number {
  const wall = wallClock(at, timeZone)
  switch (interval) {
    case 'hour':
      return at - wall.minute * MINUTE - (at % MINUTE)
    case 'day':
      return zonedTime(timeZone, wall.year, wall.month, wall.day)
    case 'week': {
      const weekday = (new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay() + 6) % 7
      return zonedTime(timeZone, wall.year, wall.month, wall.day - weekday)
    }
    case 'month':
      return zonedTime(timeZone, wall.year, wall.month)
  }
}

function nextBucket(start: number, interval: Interval, timeZone: string): number {
  if (interval === 'hour') return start + HOUR
  const wall = wallClock(start, timeZone)
  if (interval === 'month') return zonedTime(timeZone, wall.year, wall.month + 1)
  return zonedTime(timeZone, wall.year, wall.month, wall.day + (interval === 'week' ? 7 : 1))
}

/** Start of every bucket that overlaps `[from, to)`, so charts have no gaps. */
export function bucketStarts(from: number, to: number, interval: Interval, timeZone: string): number[] {
  const starts: number[] = []
  for (let start = startOfBucket(from, interval, timeZone); start < to;) {
    starts.push(start)
    start = nextBucket(start, interval, timeZone)
  }
  return starts
}

/** A sensible bucket size for a range: hours up to two days, then days, weeks and months. */
export function autoInterval(from: number, to: number): Interval {
  const span = to - from
  if (span <= 2 * DAY) return 'hour'
  if (span <= 120 * DAY) return 'day'
  if (span <= 400 * DAY) return 'week'
  return 'month'
}

const MAX_BUCKETS = 1000

/** The requested interval, unless it would produce more buckets than a chart can show. */
export function clampInterval(from: number, to: number, interval: Interval | undefined): Interval {
  const size = { hour: HOUR, day: DAY, week: 7 * DAY, month: 31 * DAY }
  if (interval && (to - from) / size[interval] <= MAX_BUCKETS) return interval
  return autoInterval(from, to)
}

/**
 * Parses an ISO 8601 date or date-time. A plain date (`2026-03-01`) means midnight in `timeZone`;
 * with `endOfDay` it means the midnight after, so a `to` date includes the whole day.
 */
export function parseDate(value: string, timeZone: string, endOfDay = false): number | null {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (date) {
    return zonedTime(timeZone, Number(date[1]), Number(date[2]), Number(date[3]) + (endOfDay ? 1 : 0))
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return null
  const at = Date.parse(value)
  return Number.isNaN(at) ? null : at
}

/** The UTC month an instant falls in, as `YYYY-MM`. Salts rotate on this key. */
export function monthKey(at: number): string {
  return new Date(at).toISOString().slice(0, 7)
}
