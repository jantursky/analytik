import { AnimatePresence, motion } from 'motion/react'
import { lazy, type ReactNode, Suspense, useState } from 'react'

import { EASE } from './ui/motion'

// Recharts is a big dependency: it loads with the first chart, not with the dashboard.
const AreaPlot = lazy(() => import('./chart-plot').then((m) => ({ default: m.AreaPlot })))
const SparkPlot = lazy(() => import('./chart-plot').then((m) => ({ default: m.SparkPlot })))

export interface ChartPoint {
  ts: number
  value: number
}

export interface AreaChartSecondary {
  /** What the values are, e.g. "Revenue". */
  label: string
  /** One value per point, drawn as bars against an axis on the right. */
  values: number[]
  formatValue: (value: number) => string
}

export interface AreaChartProps {
  points: ChartPoint[]
  /** What the values are, e.g. "Visitors". */
  label: string
  formatValue: (value: number) => string
  formatTime: (ts: number) => string
  /** A second series with its own scale, e.g. revenue next to visitors. */
  secondary?: AreaChartSecondary
  /** Plot height in pixels. Default 200. */
  height?: number
}

/**
 * An area chart (Recharts, loaded on first use), optionally with a second series as bars on its own axis; the legend
 * buttons switch series on and off. Screen readers get a summary and the values as a table.
 */
export function AreaChart({ points, label, formatValue, formatTime, secondary, height = 200 }: AreaChartProps) {
  const [hidden, setHidden] = useState({ primary: false, secondary: false })
  if (!points.length) return <p className="analytik-empty">No data for this period</p>

  const peak = points.reduce((best, p) => (p.value > best.value ? p : best))
  const rows = points.map((p, i) => ({ ...p, ...(secondary ? { secondary: secondary.values[i] ?? 0 } : {}) }))
  const legend = secondary && (
    <div className="analytik-legend" role="group" aria-label="Series">
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
    <figure className="analytik-chart">
      {legend}
      <div className="analytik-chart-plot" style={{ height }}>
        <Suspense fallback={<div className="analytik-chart-skeleton" />}>
          <AreaPlot
            rows={rows}
            label={label}
            formatValue={formatValue}
            formatTime={formatTime}
            secondary={secondary}
            hidden={hidden}
            height={height}
          />
        </Suspense>
      </div>
      <figcaption className="analytik-sr-only">
        {`${label}, ${points.length} points, peak ${formatValue(peak.value)} at ${formatTime(peak.ts)}`}
      </figcaption>
      <table className="analytik-sr-only">
        <thead>
          <tr>
            <th scope="col">Time</th>
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
    </figure>
  )
}

export interface BarListRow {
  key: string
  label?: ReactNode
  value: number
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
}

/** Ranked rows with a proportional bar behind each; rows fade in and bars grow to their width. */
export function BarList({ rows, label, formatValue, onSelect, limit = 10 }: BarListProps) {
  if (!rows.length) return <p className="analytik-empty">No data for this period</p>
  const max = Math.max(...rows.map((r) => r.value), 1)
  return (
    <ul className="analytik-bars" aria-label={label}>
      <AnimatePresence initial={false}>
        {rows.slice(0, limit).map((row, index) => {
          const content = (
            <>
              <motion.span
                className="analytik-bar-fill"
                initial={{ width: 0 }}
                animate={{ width: `${(row.value / max) * 100}%` }}
                transition={{ duration: 0.6, ease: EASE, delay: Math.min(index, 10) * 0.03 }}
                aria-hidden="true"
              />
              <span className="analytik-bar-label">{row.label ?? (row.key || '(none)')}</span>
              <span className="analytik-bar-value">{formatValue(row.value)}</span>
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
                  <span className="analytik-sr-only">, filter by this</span>
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

/** A tiny trend line; decorative, so hidden from assistive technology. */
export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null
  return (
    <span className="analytik-sparkline" aria-hidden="true">
      <Suspense fallback={null}>
        <SparkPlot values={values} />
      </Suspense>
    </span>
  )
}
