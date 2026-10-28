// Loaded on first use by Dashboard.tsx: the command palette and the shortcuts help, with the action list they share.
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react'

import type { Segment } from '../shared/segments'
import type { Comparison, Filters, Site } from '../shared/types'
import type { DashboardView } from './Dashboard'
import { countryName } from './format'
import { t } from './i18n'
import { type DateRange, presetRange, RANGE_PRESETS } from './range'
import { GO_KEYS } from './shortcuts'
import { Dialog } from './ui/dialog'
import { DIMENSION_LABELS } from './views/Breakdown'

/** What the palette can do to the dashboard. Everything it searches is already in memory: it makes no requests. */
export interface PaletteControls {
  views: { value: DashboardView; label: string }[]
  go: (view: DashboardView) => void
  sites: Site[]
  siteId: string | undefined
  openSite: (id: string) => void
  setRange: (range: DateRange) => void
  live: boolean
  setLive: (on: boolean) => void
  cycleTheme: () => void
  refresh: () => void
  compare: Comparison | undefined
  setCompare: (compare: Comparison | undefined) => void
  segments: Segment[]
  applySegment: (segment: Segment) => void
  filters: Filters
  clearFilters: () => void
  addFilter: (dimension: string, value: string) => void
  /** The values each breakdown block on screen has loaded, by dimension. */
  known: ReadonlyMap<string, string[]>
}

export interface PaletteAction {
  id: string
  group: string
  label: string
  /** Extra words the search also matches. */
  keywords?: string
  /** The shortcut, shown at the end of the row. */
  hint?: string
  run: () => void
}

const GROUPS = ['Go to', 'Range', 'Site', 'Compare', 'Segment', 'Filter', 'Other'] as const

/** Matches every word of `query` in `text`, in order within a word; the lower the score the better, `null` for none. */
export function fuzzyScore(query: string, text: string): number | null {
  const haystack = text.toLowerCase()
  let total = 0
  for (const word of query.toLowerCase().split(/\s+/).filter(Boolean)) {
    const at = haystack.indexOf(word)
    if (at >= 0) {
      // A word that starts a word of the text beats one found in the middle.
      total += at === 0 || /\W/.test(haystack[at - 1] ?? '') ? at : at + 20
      continue
    }
    let position = -1
    let gaps = 0
    for (const char of word) {
      const next = haystack.indexOf(char, position + 1)
      if (next < 0) return null
      gaps += position < 0 ? 0 : next - position - 1
      position = next
    }
    // Letters of a word may skip a few characters of the text ("rvn" finds "Revenue"), not wander across it.
    if (gaps > word.length) return null
    total += 50 + gaps
  }
  return total
}

/** Every action the palette offers right now; filter suggestions come only from values the blocks on screen loaded. */
export function buildActions(c: PaletteControls): PaletteAction[] {
  const go = (key: string) => `g ${key}`
  const keyOf = (view: DashboardView) => Object.entries(GO_KEYS).find(([, v]) => v === view)?.[0]
  const actions: PaletteAction[] = []
  for (const { value, label } of c.views) {
    const key = keyOf(value)
    actions.push({
      id: `go:${value}`,
      group: 'Go to',
      label: t('Go to {view}', { view: t(label) }),
      hint: key && go(key),
      run: () => c.go(value),
    })
  }
  for (const { value, label } of RANGE_PRESETS) {
    if (value === 'custom') continue
    actions.push({
      id: `range:${value}`,
      group: 'Range',
      label: t('Range: {range}', { range: t(label) }),
      run: () => c.setRange(presetRange(value, Date.now())),
    })
  }
  for (const site of c.sites) {
    if (site.id === c.siteId) continue
    actions.push({
      id: `site:${site.id}`,
      group: 'Site',
      label: t('Switch to {site}', { site: site.name }),
      keywords: site.domain,
      run: () => c.openSite(site.id),
    })
  }
  const compares: [Comparison | undefined, string][] = [
    [undefined, t('No comparison')],
    ['previous', t('Previous period')],
    ['year', t('Same period last year')],
  ]
  for (const [value, label] of compares) {
    if (value === c.compare) continue
    actions.push({
      id: `compare:${value ?? 'off'}`,
      group: 'Compare',
      label: t('Compare: {option}', { option: label }),
      run: () => c.setCompare(value),
    })
  }
  for (const segment of c.segments) {
    actions.push({
      id: `segment:${segment.id}`,
      group: 'Segment',
      label: t('Segment: {name}', { name: segment.name }),
      run: () => c.applySegment(segment),
    })
  }
  if (Object.values(c.filters).some((value) => value != null)) {
    actions.push({ id: 'clear-filters', group: 'Filter', label: t('Clear all filters'), run: c.clearFilters })
  }
  for (const [dimension, values] of c.known) {
    const name = DIMENSION_LABELS[dimension as keyof typeof DIMENSION_LABELS]
    if (!name || c.filters[dimension] != null) continue
    for (const value of values) {
      const shown = dimension === 'country' ? countryName(value) : value
      actions.push({
        id: `filter:${dimension}:${value}`,
        group: 'Filter',
        label: t('Filter: {dimension} is {value}', { dimension: t(name).toLowerCase(), value: shown || t('(none)') }),
        keywords: `${value} ${dimension}`,
        run: () => c.addFilter(dimension, value),
      })
    }
  }
  actions.push(
    {
      id: 'live',
      group: 'Other',
      label: c.live ? t('Turn Live off') : t('Turn Live on'),
      run: () => c.setLive(!c.live),
    },
    { id: 'theme', group: 'Other', label: t('Switch theme'), run: c.cycleTheme },
    { id: 'refresh', group: 'Other', label: t('Refresh'), hint: 'r', run: c.refresh },
  )
  return actions
}

const MAX_RESULTS = 40

/** What the search shows: nothing but the plain commands until something is typed, then the best matches. */
export function search(actions: PaletteAction[], query: string): PaletteAction[] {
  const typed = query.trim()
  const pool = typed ? actions : actions.filter((a) => a.group !== 'Filter' || a.id === 'clear-filters')
  if (!typed) return pool.slice(0, MAX_RESULTS)
  return pool
    .flatMap((action) => {
      const score = fuzzyScore(typed, `${action.label} ${action.keywords ?? ''}`)
      return score === null ? [] : [{ action, score }]
    })
    .sort(
      (a, b) => a.score - b.score || GROUPS.indexOf(a.action.group as never) - GROUPS.indexOf(b.action.group as never),
    )
    .slice(0, MAX_RESULTS)
    .map(({ action }) => action)
}

/** Keeps focus where it was before the palette opened, and puts it back when it closes. */
function useRestoreFocus(): void {
  useEffect(() => {
    const before = document.activeElement
    return () => {
      if (before instanceof HTMLElement) before.focus()
    }
  }, [])
}

/** ⌘K: type to find a view, range, site, segment or a value on screen, and press Enter. */
export function Palette({ controls, onClose }: { controls: PaletteControls; onClose: () => void }) {
  useRestoreFocus()
  const listId = useId()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const actions = useMemo(() => buildActions(controls), [controls])
  const results = useMemo(() => search(actions, query), [actions, query])
  const active = results[Math.min(index, results.length - 1)]
  const list = useRef<HTMLUListElement>(null)

  useEffect(() => {
    // Not every environment can scroll (tests), so ask before calling.
    const selected: Partial<Element> | null | undefined = list.current?.querySelector('[aria-selected="true"]')
    selected?.scrollIntoView?.({ block: 'nearest' })
  }, [index, query])

  const choose = (action: PaletteAction | undefined): void => {
    if (!action) return
    onClose()
    action.run()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setIndex(
        (current) => (Math.min(current, results.length - 1) + step + results.length) % Math.max(results.length, 1),
      )
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(active)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={t('Command palette')}>
      <div className="analytik-palette">
        <input
          className="analytik-input"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={active ? `${listId}-${active.id}` : undefined}
          aria-autocomplete="list"
          aria-label={t('Search commands')}
          placeholder={t('Type a command, a page, a range or a value…')}
          value={query}
          autoFocus
          onChange={(event) => {
            setQuery(event.target.value)
            setIndex(0)
          }}
          onKeyDown={onKeyDown}
        />
        <ul id={listId} ref={list} role="listbox" aria-label={t('Commands')} className="analytik-palette-list">
          {results.map((action, position) => {
            const heading = action.group !== results[position - 1]?.group
            return (
              <li key={action.id} role="presentation">
                {heading && <span className="analytik-palette-group">{t(action.group)}</span>}
                <div
                  id={`${listId}-${action.id}`}
                  role="option"
                  aria-selected={action === active}
                  className="analytik-palette-option"
                  onMouseMove={() => setIndex(results.indexOf(action))}
                  onClick={() => choose(action)}
                >
                  <span>{action.label}</span>
                  {action.hint && <kbd>{action.hint}</kbd>}
                </div>
              </li>
            )
          })}
        </ul>
        <p className="analytik-sr-only" role="status">
          {results.length === 0
            ? t('No matching commands')
            : t('{count, plural, one {# result} other {# results}}', { count: results.length })}
        </p>
        {results.length === 0 && <p className="analytik-empty">{t('No matching commands')}</p>}
      </div>
    </Dialog>
  )
}

const isMac = (): boolean => typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.userAgent)

/** `?`: every shortcut, written out. */
export function ShortcutHelp({
  views,
  onClose,
}: {
  views: { value: DashboardView; label: string }[]
  onClose: () => void
}) {
  useRestoreFocus()
  const rows: [string, string][] = [
    [isMac() ? '⌘ K' : 'Ctrl K', t('Open the command palette')],
    ...Object.entries(GO_KEYS).map(([key, view]): [string, string] => [
      `g ${key}`,
      t('Go to {view}', { view: t(views.find((v) => v.value === view)?.label ?? view) }),
    ]),
    ['[', t('Previous period')],
    [']', t('Next period')],
    ['r', t('Refresh')],
    ['?', t('Show these shortcuts')],
  ]
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={t('Keyboard shortcuts')}>
      <dl className="analytik-shortcuts">
        {rows.map(([keys, what]) => (
          <div key={keys}>
            <dt>
              <kbd>{keys}</kbd>
            </dt>
            <dd>{what}</dd>
          </div>
        ))}
      </dl>
      <p className="analytik-field-hint analytik-shortcuts-note">
        {t('Shortcuts are off while typing in a field or when a dialog is open.')}
      </p>
    </Dialog>
  )
}
