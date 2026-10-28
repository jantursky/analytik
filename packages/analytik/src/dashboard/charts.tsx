import { AnimatePresence, motion } from 'motion/react'
import { type CSSProperties, lazy, type ReactNode, Suspense, useState } from 'react'

import { t } from './i18n'
import { EASE } from './ui/motion'

// Recharts is a big dependency: it loads with the first chart, not with the dashboard.
const AreaPlot = lazy(() => import('./chart-plot').then((m) => ({ default: m.AreaPlot })))
const SparkPlot = lazy(() => import('./chart-plot').then((m) => ({ default: m.SparkPlot })))
const MultiPlot = lazy(() => import('./chart-plot').then((m) => ({ default: m.MultiPlot })))

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
}: AreaChartProps) {
  const [hidden, setHidden] = useState({ primary: false, secondary: false })
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
    </figure>
  )
}

export interface ChartSeries {
  /** Unique within the chart, e.g. the metric name. */
  key: string
  label: string
  /** One value per time. */
  values: number[]
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
}

/**
 * Any number of metrics over one time axis, each drawn its own way, with a legend that switches each one on and off.
 * Screen readers get a summary and every value in a table.
 */
export function MultiChart({ times, series, formatTime, height = 200 }: MultiChartProps) {
  const [hidden, setHidden] = useState<string[]>([])
  if (!times.length || !series.length) return <p className="analytik-empty">{t('Nothing recorded in this period')}</p>

  const shown = series.filter((s) => !hidden.includes(s.key))
  const rows = times.map((ts, i) => ({ ts, ...Object.fromEntries(shown.map((s) => [s.key, s.values[i] ?? 0])) }))
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
  /** Revenue rows get the revenue colour. */
  metric?: string
}

/** Ranked rows with a proportional meter under each; rows fade in and meters grow to their length. */
export function BarList({ rows, label, formatValue, onSelect, limit = 10, metric }: BarListProps) {
  if (!rows.length) return <p className="analytik-empty">{t('Nothing recorded in this period')}</p>
  const max = Math.max(...rows.map((r) => r.value), 1)
  return (
    <ul className="analytik-bars" aria-label={label} data-metric={metric}>
      <AnimatePresence initial={false}>
        {rows.slice(0, limit).map((row, index) => {
          const content = (
            <>
              <motion.span
                className="analytik-bar-fill"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: row.value / max }}
                transition={{ duration: 0.6, ease: EASE, delay: Math.min(index, 10) * 0.03 }}
                aria-hidden="true"
              />
              <span className="analytik-bar-label">{row.label ?? (row.key || t('(none)'))}</span>
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
