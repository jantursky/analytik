import type { Interval } from '../shared/types'

const LOCALE = 'en-US'

/** How numbers, money, dates and times are written; chosen in Settings → Formatting and kept in the preferences. */
export interface FormatSettings {
  /** Digit grouping and decimal mark: 1,234.5 · 1.234,5 · 1 234,5 · 1'234.5. */
  numbers: 'comma' | 'dot' | 'space' | 'apostrophe'
  /** $1,234.50 or USD 1,234.50. */
  currency: 'symbol' | 'code'
  /** Cents on every amount, or only when an amount has them. */
  cents: 'always' | 'auto'
  /** Oct 27, 2026 · 27 Oct 2026 · 27.10.2026 · 10/27/2026 · 2026-10-27. */
  date: 'us' | 'gb' | 'dmy' | 'mdy' | 'iso'
  time: '12h' | '24h'
}

export const DEFAULT_FORMAT: FormatSettings = {
  numbers: 'comma',
  currency: 'symbol',
  cents: 'always',
  date: 'us',
  time: '12h',
}

const CHOICES: { [K in keyof FormatSettings]: readonly FormatSettings[K][] } = {
  numbers: ['comma', 'dot', 'space', 'apostrophe'],
  currency: ['symbol', 'code'],
  cents: ['always', 'auto'],
  date: ['us', 'gb', 'dmy', 'mdy', 'iso'],
  time: ['12h', '24h'],
}

/** Saved formatting settings, with anything unknown replaced by the default. */
export function parseFormatSettings(value: unknown): FormatSettings {
  const saved = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const pick = <K extends keyof FormatSettings>(key: K): FormatSettings[K] =>
    (CHOICES[key] as readonly unknown[]).includes(saved[key]) ? (saved[key] as FormatSettings[K]) : DEFAULT_FORMAT[key]
  return {
    numbers: pick('numbers'),
    currency: pick('currency'),
    cents: pick('cents'),
    date: pick('date'),
    time: pick('time'),
  }
}

// Number styles borrow a locale's separators; the words around them stay English.
const NUMBER_LOCALES: Record<FormatSettings['numbers'], string> = {
  comma: 'en-US',
  dot: 'de-DE',
  space: 'fr-FR',
  apostrophe: 'de-CH',
}

interface Formatters {
  settings: FormatSettings
  locale: string
  integer: Intl.NumberFormat
  compact: Intl.NumberFormat
  money: Map<string, Intl.NumberFormat>
}

function formattersFor(settings: FormatSettings): Formatters {
  const locale = NUMBER_LOCALES[settings.numbers]
  return {
    settings,
    locale,
    integer: new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }),
    compact: new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }),
    money: new Map(),
  }
}

let current = formattersFor(DEFAULT_FORMAT)

/**
 * Switches every formatter below to `settings`. The dashboard calls it with the saved preferences before it renders,
 * so all of its parts write numbers and dates the same way.
 */
export function setFormatSettings(settings: FormatSettings): void {
  const same = (Object.keys(settings) as (keyof FormatSettings)[]).every(
    (key) => settings[key] === current.settings[key],
  )
  if (!same) current = formattersFor(settings)
}

export const formatSettings = (): FormatSettings => current.settings

function moneyFormat(currency: string, compact = false): Intl.NumberFormat {
  const key = `${currency}${compact ? ':compact' : ''}`
  let format = current.money.get(key)
  if (!format) {
    format = new Intl.NumberFormat(current.locale, {
      style: 'currency',
      currency,
      currencyDisplay: current.settings.currency,
      ...(compact
        ? { notation: 'compact', maximumFractionDigits: 1 }
        : current.settings.cents === 'auto' && { trailingZeroDisplay: 'stripIfInteger' }),
    })
    current.money.set(key, format)
  }
  return format
}

/** Minor units per major unit: 100 for USD, 1 for JPY. */
const minorUnits = (currency: string): number =>
  10 ** (new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2)

/** Exact below 10,000, compact above (12.3K). */
export function formatNumber(value: number): string {
  return Math.abs(value) < 10000 ? current.integer.format(value) : current.compact.format(value)
}

/** Every digit, for tooltips next to a compact number: 101,098. */
export const formatInteger = (value: number): string => current.integer.format(value)

/** Formats an amount in minor units (cents) in `currency`. */
export function formatMoney(minor: number, currency: string): string {
  try {
    return moneyFormat(currency).format(minor / minorUnits(currency))
  } catch {
    return `${current.integer.format(minor / 100)} ${currency}`
  }
}

/**
 * Like `formatMoney`, but compact from 10,000 up ($101.1K), for tiles too narrow for the full amount; show the exact
 * amount next to it, e.g. in a tooltip.
 */
export function formatMoneyShort(minor: number, currency: string): string {
  try {
    const major = minor / minorUnits(currency)
    return Math.abs(major) < 10000 ? moneyFormat(currency).format(major) : moneyFormat(currency, true).format(major)
  } catch {
    return formatMoney(minor, currency)
  }
}

/** A ratio (0.123) as a percentage (12.3%). */
export function formatPercent(ratio: number): string {
  const digits = Math.abs(ratio) < 0.1 && ratio !== 0 ? 1 : 0
  return new Intl.NumberFormat(current.locale, {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(ratio)
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

interface DayParts {
  year: string
  month: string
  day: string
  /** Short English month name. */
  name: string
}

function dayParts(ts: number, timeZone?: string): DayParts {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(ts)
      .map((part) => [part.type, part.value]),
  )
  return {
    year: parts.year ?? '',
    month: parts.month ?? '',
    day: parts.day ?? '',
    name: new Intl.DateTimeFormat('en-US', { timeZone, month: 'short' }).format(ts),
  }
}

/** A day in the chosen style, with or without its year: Oct 27, 2026 · 27.10. · 2026-10-27. */
export function formatDate(ts: number, timeZone?: string, withYear = true): string {
  const { year, month, day, name } = dayParts(ts, timeZone)
  const plain = String(Number(day))
  switch (current.settings.date) {
    case 'gb':
      return withYear ? `${plain} ${name} ${year}` : `${plain} ${name}`
    case 'dmy':
      return withYear ? `${day}.${month}.${year}` : `${day}.${month}.`
    case 'mdy':
      return withYear ? `${month}/${day}/${year}` : `${month}/${day}`
    case 'iso':
      return withYear ? `${year}-${month}-${day}` : `${month}-${day}`
    default:
      return withYear ? `${name} ${plain}, ${year}` : `${name} ${plain}`
  }
}

/** A month in the chosen style: Oct 2026 · 10.2026 · 10/2026 · 2026-10. */
function formatMonth(ts: number, timeZone?: string): string {
  const { year, month, name } = dayParts(ts, timeZone)
  switch (current.settings.date) {
    case 'dmy':
      return `${month}.${year}`
    case 'mdy':
      return `${month}/${year}`
    case 'iso':
      return `${year}-${month}`
    default:
      return `${name} ${year}`
  }
}

/** A time of day in the chosen clock: 3:05 PM or 15:05. */
export function formatTime(ts: number, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: current.settings.time === '12h' ? 'numeric' : '2-digit',
    minute: '2-digit',
    hourCycle: current.settings.time === '12h' ? 'h12' : 'h23',
  }).format(ts)
}

export function formatBucket(ts: number, interval: Interval, timeZone?: string): string {
  if (interval === 'hour') return formatTime(ts, timeZone)
  if (interval === 'month') return formatMonth(ts, timeZone)
  return formatDate(ts, timeZone, false)
}

export function formatDateTime(ts: number, timeZone?: string): string {
  const style = current.settings.date
  return `${formatDate(ts, timeZone)}${style === 'us' || style === 'gb' ? ',' : ''} ${formatTime(ts, timeZone)}`
}

/** Two days, both included, as a compact range ("Oct 1 – 3, 2026"); one day when they are the same. */
export function formatDayRange(first: number, last: number): string {
  const [from, to] = [Math.min(first, last), Math.max(first, last)]
  const style = current.settings.date
  if (style === 'us' || style === 'gb') {
    const locale = style === 'us' ? 'en-US' : 'en-GB'
    return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' }).formatRange(from, to)
  }
  const a = formatDate(from)
  const b = formatDate(to)
  return a === b ? a : `${a} – ${b}`
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
