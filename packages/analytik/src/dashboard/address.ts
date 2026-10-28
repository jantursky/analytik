import { DIMENSIONS } from '../shared/dimensions'
import type { Comparison, Filters, Interval } from '../shared/types'
import { customRange, type DateRange, intervalFor, presetRange, RANGE_PRESETS, toDateInput } from './range'

const INTERVALS: readonly Interval[] = ['hour', 'day', 'week', 'month']
const PRESETS = RANGE_PRESETS.map((p) => p.value).filter((value) => value !== 'custom')
const DEFAULT_PRESET = '7d'
const FILTER = 'f.'
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** What the dashboard keeps in the address: the site, view, Settings section, date range and filters. */
export interface AddressState {
  site?: string
  view?: string
  tab?: string
  range?: DateRange
  compare?: Comparison
  filters: Filters
  /** A saved segment's id, standing for its filters. */
  segment?: string
}

/** What an address may name; anything else is ignored. */
export interface AddressVocabulary {
  views: readonly string[]
  tabs: readonly string[]
}

const startsAtMidnight = (ms: number): boolean => new Date(ms).setHours(0, 0, 0, 0) === ms

function readRange(params: URLSearchParams, now: number): DateRange | undefined {
  const from = params.get('from')
  const to = params.get('to')
  let range: DateRange | undefined
  if (from && to) {
    if (DATE.test(from) && DATE.test(to)) range = customRange(from, to) ?? undefined
    else if (/^\d+$/.test(from) && /^\d+$/.test(to) && Number(to) > Number(from)) {
      range = { preset: 'custom', from: Number(from), to: Number(to), interval: intervalFor(Number(from), Number(to)) }
    }
  } else {
    const preset = params.get('range')
    if (preset && (PRESETS as string[]).includes(preset)) {
      range = presetRange(preset as Exclude<DateRange['preset'], 'custom'>, now)
    }
  }
  const interval = params.get('interval')
  if (range && interval && (INTERVALS as readonly string[]).includes(interval)) {
    range = { ...range, interval: interval as Interval }
  }
  return range
}

/** The state an address names; values the dashboard does not know are left out. */
export function readAddress(search: string, vocabulary: AddressVocabulary, now = Date.now()): AddressState {
  const params = new URLSearchParams(search)
  const view = params.get('section')
  const tab = params.get('tab')
  const filters: Filters = {}
  for (const [key, value] of params) {
    const dimension = key.slice(FILTER.length)
    if (key.startsWith(FILTER) && (DIMENSIONS as readonly string[]).includes(dimension)) filters[dimension] = value
  }
  return {
    site: params.get('site') ?? undefined,
    view: view && vocabulary.views.includes(view) ? view : undefined,
    tab: tab && vocabulary.tabs.includes(tab) ? tab : undefined,
    range: readRange(params, now),
    compare:
      params.get('compare') === 'previous' || params.get('compare') === 'year'
        ? (params.get('compare') as Comparison)
        : undefined,
    filters,
    segment: params.get('segment') ?? undefined,
  }
}

/** The address with the state written into it; other parameters, such as the host page's own, stay as they are. */
export function writeAddress(url: URL, state: AddressState): URL {
  const next = new URL(url)
  const params = next.searchParams
  for (const key of [...params.keys()]) if (key.startsWith(FILTER)) params.delete(key)
  params.delete('segment')
  for (const key of ['range', 'from', 'to', 'interval', 'compare']) params.delete(key)
  const set = (key: string, value: string | undefined, fallback?: string): void => {
    if (value && value !== fallback) params.set(key, value)
    else params.delete(key)
  }
  set('site', state.site)
  set('section', state.view, 'overview')
  set('tab', state.view === 'settings' ? state.tab : undefined)
  const { range } = state
  if (range) {
    if (range.preset === 'custom') {
      const aligned = startsAtMidnight(range.from) && startsAtMidnight(range.to)
      params.set('from', aligned ? toDateInput(range.from) : String(range.from))
      params.set('to', aligned ? toDateInput(range.to - 1) : String(range.to))
    } else if (range.preset !== DEFAULT_PRESET) params.set('range', range.preset)
    const usual =
      range.preset === 'custom' ? intervalFor(range.from, range.to) : presetRange(range.preset, range.to).interval
    if (range.interval !== usual) params.set('interval', range.interval)
  }
  if (state.compare) params.set('compare', state.compare)
  // A saved segment stands for its filters, so a linked address stays short.
  if (state.segment) params.set('segment', state.segment)
  else {
    for (const [dimension, value] of Object.entries(state.filters))
      if (value != null) params.set(FILTER + dimension, value)
  }
  return next
}
