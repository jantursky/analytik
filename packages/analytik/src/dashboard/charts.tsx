import { AnimatePresence, motion } from 'motion/react'
import { type CSSProperties, lazy, type ReactNode, Suspense, useState } from 'react'

import { type ChartNote, type NoteActions, NotesPanel, type NotesView } from './chart-notes'
import { CopyId } from './copy-id'
import { download, fileName } from './export'
import { formatChange, formatShare } from './format'
import { Icon } from './icons'
import { t } from './i18n'
import { EASE } from './ui/motion'
import { useToast } from './ui/toast'

// Recharts is a big dependency: it loads with the first chart, not with the dashboard.
const AreaPlot = lazy(() => import('./chart-plot').then((m) => ({ default: m.AreaPlot })))
const SparkPlot = lazy(() => import('./chart-plot').then((m) => ({ default: m.SparkPlot })))
const MultiPlot = lazy(() => import('./chart-plot').then((m) => ({ default: m.MultiPlot })))

/** Saves the chart it sits in as a PNG; the encoder is its own chunk, fetched on the first click. */
function ExportPng({ label }: { label: string }) {
  const toast = useToast()
  return (
    <button
      type="button"
      className="analytik-details analytik-export analytik-chart-export"
      onClick={(event) => {
        const figure = event.currentTarget.closest('figure')
        if (!figure) return
        void import('./chart-export')
          .then((m) => m.chartPng(figure, label))
          .then((blob) => download(fileName([label], 'png'), blob))
          .catch((error: unknown) => toast?.(error instanceof Error ? error.message : t('Export failed'), false))
      }}
    >
      <Icon name="download" />
      {t('Export PNG')}
    </button>
  )
}

export type { ChartNote, NoteActions }

/** The notes flagged on a chart and the Add note button; shared by the area and the multi chart. */
function useNotes(
  notes: ChartNote[] | undefined,
  actions: NoteActions | undefined,
  formatTime: (ts: number) => string,
  onChanged?: () => void,
) {
  const [view, setView] = useState<NotesView | null>(null)
  return {
    open: notes?.length || actions ? (list: ChartNote[]) => setView({ kind: 'list', notes: list }) : undefined,
    add: actions ? (
      <button type="button" className="analytik-details analytik-export" onClick={() => setView({ kind: 'form' })}>
        <Icon name="plus" />
        {t('Add note')}
      </button>
    ) : null,
    panel: view && (
      <NotesPanel
        view={view}
        actions={actions}
        formatTime={formatTime}
        onView={setView}
        onClose={() => setView(null)}
        onChanged={() => onChanged?.()}
      />
    ),
  }
}

export interface ChartPoint {
  ts: number
  value: number
  /** The value of the same bucket in the comparison period, drawn as a lighter dashed line. */
  previous?: number
}

export interface AreaChartSecondary {
  /** What the values are, e.g. "Revenue". */
  label: string
  /** One value per point, drawn as bars against an axis on the right. */
  values: number[]
  formatValue: (value: number) => string
  /** Shorter labels for its axis, e.g. $1.2M; default `formatValue`. */
  formatAxis?: (value: number) => string
}

export interface AreaChartProps {
  points: ChartPoint[]
  /** What the values are, e.g. "Visitors". */
  label: string
  /** The exact value, for the tooltip and the table. */
  formatValue: (value: number) => string
  /** Shorter labels for the axis, e.g. 12K; default `formatValue`. */
  formatAxis?: (value: number) => string
  formatTime: (ts: number) => string
  /** A second series with its own scale, e.g. revenue next to visitors. */
  secondary?: AreaChartSecondary
  /** Plot height in pixels. Default 200. */
  height?: number
  /** How the main series is drawn. Default `area`. */
  kind?: 'area' | 'line' | 'bars'
  /** CSS colour of the main series. Default the first series colour. */
  colour?: string
  /** Dated notes flagged on the chart; clicking a flag lists them. */
  notes?: ChartNote[]
  /** Lets the person add, change and delete notes; left out the notes can only be read. */
  noteActions?: NoteActions
  /** Called after a note was added, changed or deleted, so the chart's data can be loaded again. */
  onNotesChanged?: () => void
}

/**
 * An area chart (Recharts, loaded on first use), optionally with a second series as bars on its own axis; the legend
 * buttons switch series on and off. Screen readers get a summary and the values as a table.
 */
export function AreaChart({
  points,
  label,
  formatValue,
  formatAxis,
  formatTime,
  secondary,
  height = 200,
  kind = 'area',
  colour,
  notes,
  noteActions,
  onNotesChanged,
}: AreaChartProps) {
  const [hidden, setHidden] = useState({ primary: false, secondary: false })
  const flags = useNotes(notes, noteActions, formatTime, onNotesChanged)
  if (!points.length) return <p className="analytik-empty">{t('Nothing recorded in this period')}</p>

  const peak = points.reduce((best, p) => (p.value > best.value ? p : best))
  const rows = points.map((p, i) => ({ ...p, ...(secondary ? { secondary: secondary.values[i] ?? 0 } : {}) }))
  const legend = secondary && (
    <div className="analytik-legend" role="group" aria-label={t('Series')}>
      {(['primary', 'secondary'] as const).map((key) => (
        <button
          key={key}
          type="button"
          className="analytik-legend-item"
          data-series={key}
          aria-pressed={!hidden[key]}
          onClick={() => setHidden({ ...hidden, [key]: !hidden[key] })}
        >
          <span className="analytik-marker" aria-hidden="true" />
          {key === 'primary' ? label : secondary.label}
        </button>
      ))}
    </div>
  )

  return (
    <figure
      className="analytik-chart"
      style={colour ? ({ '--analytik-primary-series': colour } as CSSProperties) : undefined}
    >
      {legend}
      <div className="analytik-chart-plot" style={{ height }}>
        <Suspense fallback={<div className="analytik-chart-skeleton" />}>
          <AreaPlot
            rows={rows}
            label={label}
            formatValue={formatValue}
            formatAxis={formatAxis}
            formatTime={formatTime}
            secondary={secondary}
            hidden={hidden}
            height={height}
            kind={kind}
            notes={notes}
            onNotes={flags.open}
          />
        </Suspense>
      </div>
      <figcaption className="analytik-sr-only">
        {t('{label}, {count, plural, one {# point} other {# points}}, peak {peak} at {time}', {
          label,
          count: points.length,
          peak: formatValue(peak.value),
          time: formatTime(peak.ts),
        })}
      </figcaption>
      <table className="analytik-sr-only">
        <thead>
          <tr>
            <th scope="col">{t('Time')}</th>
            <th scope="col">{label}</th>
            {secondary && <th scope="col">{secondary.label}</th>}
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={p.ts}>
              <th scope="row">{formatTime(p.ts)}</th>
              <td>{formatValue(p.value)}</td>
              {secondary && <td>{secondary.formatValue(secondary.values[i] ?? 0)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {flags.panel}
      <div className="analytik-chart-tools">
        {flags.add}
        <ExportPng label={label} />
      </div>
    </figure>
  )
}

export interface ChartSeries {
  /** Unique within the chart, e.g. the metric name. */
  key: string
  label: string
  /** One value per time. */
  values: number[]
  /** The same, a period earlier, drawn as a lighter dashed line; missing buckets are left out. */
  previous?: (number | undefined)[]
  kind: 'area' | 'line' | 'bars'
  /** CSS colour, also used by the legend and the tooltip. */
  colour: string
  /** Series with the same scale (e.g. `money`) share an axis. */
  scale: string
  /** The exact value, for the tooltip and the table. */
  formatValue: (value: number) => string
  /** Shorter labels for the axis; default `formatValue`. */
  formatAxis?: (value: number) => string
}

export interface MultiChartProps {
  times: number[]
  series: ChartSeries[]
  formatTime: (ts: number) => string
  /** Plot height in pixels. Default 200. */
  height?: number
  notes?: ChartNote[]
  noteActions?: NoteActions
  onNotesChanged?: () => void
}

/**
 * Any number of metrics over one time axis, each drawn its own way, with a legend that switches each one on and off.
 * Screen readers get a summary and every value in a table.
 */
export function MultiChart({
  times,
  series,
  formatTime,
  height = 200,
  notes,
  noteActions,
  onNotesChanged,
}: MultiChartProps) {
  const [hidden, setHidden] = useState<string[]>([])
  const flags = useNotes(notes, noteActions, formatTime, onNotesChanged)
  if (!times.length || !series.length) return <p className="analytik-empty">{t('Nothing recorded in this period')}</p>

  const shown = series.filter((s) => !hidden.includes(s.key))
  const rows = times.map((ts, i) => ({
    ts,
    ...Object.fromEntries(shown.map((s) => [s.key, s.values[i] ?? 0])),
    ...Object.fromEntries(
      shown.flatMap((s) => {
        const before = s.previous?.[i]
        return before === undefined ? [] : [[`${s.key}:previous`, before]]
      }),
    ),
  }))
  const label = series.map((s) => s.label).join(', ')
  const legend = series.length > 1 && (
    <div className="analytik-legend" role="group" aria-label={t('Series')}>
      {series.map((s) => (
        <button
          key={s.key}
          type="button"
          className="analytik-legend-item"
          aria-pressed={!hidden.includes(s.key)}
          onClick={() => setHidden(hidden.includes(s.key) ? hidden.filter((k) => k !== s.key) : [...hidden, s.key])}
        >
          <span className="analytik-marker" style={{ background: s.colour }} aria-hidden="true" />
          {s.label}
        </button>
      ))}
    </div>
  )

  return (
    <figure className="analytik-chart">
      {legend}
      <div className="analytik-chart-plot" style={{ height }}>
        <Suspense fallback={<div className="analytik-chart-skeleton" />}>
          <MultiPlot
            rows={rows}
            series={shown.map((s) => ({ ...s, formatAxis: s.formatAxis ?? s.formatValue }))}
            formatTime={formatTime}
            height={height}
            label={label}
            notes={notes}
            onNotes={flags.open}
          />
        </Suspense>
      </div>
      <figcaption className="analytik-sr-only">
        {t('{label}, {count, plural, one {# point} other {# points}}.', { label, count: times.length })}{' '}
        {series
          .map((s) => {
            const peak = s.values.reduce((best, v, i) => (v > (s.values[best] ?? 0) ? i : best), 0)
            return t('{label} peaks at {peak} on {time}.', {
              label: s.label,
              peak: s.formatValue(s.values[peak] ?? 0),
              time: formatTime(times[peak] ?? 0),
            })
          })
          .join(' ')}
      </figcaption>
      <table className="analytik-sr-only">
        <thead>
          <tr>
            <th scope="col">{t('Time')}</th>
            {series.map((s) => (
              <th key={s.key} scope="col">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {times.map((ts, i) => (
            <tr key={ts}>
              <th scope="row">{formatTime(ts)}</th>
              {series.map((s) => (
                <td key={s.key}>{s.formatValue(s.values[i] ?? 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {flags.panel}
      <div className="analytik-chart-tools">
        {flags.add}
        <ExportPng label={label} />
      </div>
    </figure>
  )
}

export interface BarListRow {
  key: string
  label?: ReactNode
  value: number
  /** The row's value in the comparison period: shows the change beside the value. */
  previous?: number
  /** Text a copy button next to the label puts on the clipboard, e.g. a page's address. */
  copy?: { text: string; label: string }
}

export interface BarListProps {
  rows: BarListRow[]
  /** Accessible name of the list. */
  label: string
  formatValue: (value: number) => string
  /** Makes rows buttons, e.g. to filter by the row. */
  onSelect?: (key: string) => void
  /** Rows shown. Default 10. */
  limit?: number
  /** Revenue rows get the revenue colour. */
  metric?: string
  /** What the rows add up to: meters then show each row's share of it. Without it they are scaled to the largest row. */
  total?: number
}

/** The change of a row against the comparison period; without a number to compare against it says so, never 0% or ∞. */
function RowChange({ value, previous }: { value: number; previous: number }) {
  if (previous === 0) {
    return value === 0 ? null : <span className="analytik-bar-change">{t('No data')}</span>
  }
  const change = (value - previous) / previous
  const trend = change === 0 ? 'flat' : change > 0 ? 'up' : 'down'
  return (
    <span className="analytik-bar-change analytik-delta" data-trend={trend}>
      {trend !== 'flat' && <Icon name={change > 0 ? 'up' : 'down'} />}
      <span className="analytik-sr-only">{t('Change from previous period:')} </span>
      {formatChange(change)}
    </span>
  )
}

/** Ranked rows with a proportional meter under each; rows fade in and meters grow to their length. */
export function BarList({ rows, label, formatValue, onSelect, limit = 10, metric, total }: BarListProps) {
  if (!rows.length) return <p className="analytik-empty">{t('Nothing recorded in this period')}</p>
  const scale = total && total > 0 ? total : Math.max(...rows.map((r) => r.value), 1)
  return (
    <ul className="analytik-bars" aria-label={label} data-metric={metric}>
      <AnimatePresence initial={false}>
        {rows.slice(0, limit).map((row, index) => {
          const content = (
            <>
              <motion.span
                className="analytik-bar-fill"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: Math.min(row.value / scale, 1) }}
                transition={{ duration: 0.6, ease: EASE, delay: Math.min(index, 10) * 0.03 }}
                aria-hidden="true"
              />
              {row.copy ? (
                <span className="analytik-bar-name">
                  <span className="analytik-bar-label">{row.label ?? (row.key || t('(none)'))}</span>
                  <span className="analytik-cell-actions">
                    <CopyId text={row.copy.text} label={row.copy.label} nested />
                  </span>
                </span>
              ) : (
                <span className="analytik-bar-label">{row.label ?? (row.key || t('(none)'))}</span>
              )}
              <span className="analytik-bar-figures">
                {total !== undefined && total > 0 && (
                  <span className="analytik-bar-share">{formatShare(row.value / total)}</span>
                )}
                <span className="analytik-bar-value">{formatValue(row.value)}</span>
                {row.previous !== undefined && <RowChange value={row.value} previous={row.previous} />}
              </span>
            </>
          )
          return (
            <motion.li
              key={row.key}
              layout="position"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              transition={{ duration: 0.3, ease: EASE }}
            >
              {onSelect ? (
                <button type="button" className="analytik-bar" onClick={() => onSelect(row.key)}>
                  {content}
                  <span className="analytik-sr-only">{t(', filter by this')}</span>
                </button>
              ) : (
                <div className="analytik-bar">{content}</div>
              )}
            </motion.li>
          )
        })}
      </AnimatePresence>
    </ul>
  )
}

/** What a point of a sparkline reads as when it is hovered: its time and its value, already formatted. */
export interface SparkDetail {
  when: string
  value: string
}

/**
 * A tiny trend line; decorative, so hidden from assistive technology. With `details` (one per value), resting the
 * pointer on it for a moment shows the time and value of the point under it.
 */
export function Sparkline({
  values,
  details,
  onSelect,
}: {
  values: number[]
  details?: SparkDetail[]
  /** Called with the index of the point that was clicked. */
  onSelect?: (index: number) => void
}) {
  if (values.length < 2) return null
  return (
    <span className="analytik-sparkline" aria-hidden="true">
      <Suspense fallback={null}>
        <SparkPlot values={values} details={details} onSelect={onSelect} />
      </Suspense>
    </span>
  )
}
