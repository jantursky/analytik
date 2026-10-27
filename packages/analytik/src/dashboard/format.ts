import type { Interval } from '../shared/types'

const LOCALE = 'en-US'
const integer = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 })
const compact = new Intl.NumberFormat(LOCALE, { notation: 'compact', maximumFractionDigits: 1 })

/** Exact below 10,000, compact above (12.3K). */
export function formatNumber(value: number): string {
  return Math.abs(value) < 10000 ? integer.format(value) : compact.format(value)
}

/** Formats an amount in minor units (cents) in `currency`. */
export function formatMoney(minor: number, currency: string): string {
  try {
    const format = new Intl.NumberFormat(LOCALE, { style: 'currency', currency })
    return format.format(minor / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2))
  } catch {
    return `${integer.format(minor / 100)} ${currency}`
  }
}

/** A ratio (0.123) as a percentage (12.3%). */
export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(Math.abs(ratio) < 0.1 && ratio !== 0 ? 1 : 0)}%`
}

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

/** Relative change (0.12) as a signed percentage; `null` (no previous value) as "new". */
export function formatChange(change: number | null): string {
  if (change == null) return 'new'
  const percent = Math.round(change * 100)
  return `${percent > 0 ? '+' : ''}${percent}%`
}

const dateFormats: Record<Interval, Intl.DateTimeFormatOptions> = {
  hour: { hour: '2-digit', minute: '2-digit' },
  day: { month: 'short', day: 'numeric' },
  week: { month: 'short', day: 'numeric' },
  month: { month: 'short', year: 'numeric' },
}

export function formatBucket(ts: number, interval: Interval, timeZone?: string): string {
  return new Date(ts).toLocaleString(LOCALE, { ...dateFormats[interval], timeZone })
}

export function formatDateTime(ts: number, timeZone?: string): string {
  return new Date(ts).toLocaleString(LOCALE, { dateStyle: 'medium', timeStyle: 'short', timeZone })
}

const dayRange = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric', year: 'numeric' })

/** Two days, both included, as a compact range ("Oct 1 – 3, 2026"); one day when they are the same. */
export function formatDayRange(first: number, last: number): string {
  return dayRange.formatRange(Math.min(first, last), Math.max(first, last))
}

export function formatAgo(ts: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - ts) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  return `${Math.floor(seconds / 3600)}h ago`
}

let regions: Intl.DisplayNames | undefined

/** The English name of an ISO 3166 country code ("DE" → "Germany"); the code itself when unknown. */
export function countryName(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return code
  try {
    regions ??= new Intl.DisplayNames(LOCALE, { type: 'region' })
    return regions.of(code) ?? code
  } catch {
    return code
  }
}

/** The flag emoji of an ISO 3166 country code, from its two regional indicator symbols. */
export function flagEmoji(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return ''
  return String.fromCodePoint(0x1f1a5 + code.charCodeAt(0), 0x1f1a5 + code.charCodeAt(1))
}
