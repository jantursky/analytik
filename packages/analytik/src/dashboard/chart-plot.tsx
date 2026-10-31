// Loaded on demand by charts.tsx, so Recharts stays out of the first dashboard bundle.
import { useReducedMotionConfig } from 'motion/react'
import { type CSSProperties, useEffect, useId, useRef, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from 'recharts'

import type { SparkDetail } from './charts'
import { t } from './i18n'
import { niceMax } from './scale'

export interface PlotRow {
  ts: number
  value: number
  secondary?: number
  /** The same bucket in the comparison period. */
  previous?: number
}

export interface AreaPlotProps {
  rows: PlotRow[]
  label: string
  formatValue: (value: number) => string
  formatAxis?: (value: number) => string
  formatTime: (ts: number) => string
  /** Present when there is a second series; drawn as bars against the right axis. */
  secondary?: { label: string; formatValue: (value: number) => string; formatAxis?: (value: number) => string }
  /** Series switched off in the legend. */
  hidden: { primary: boolean; secondary: boolean }
  height: number
  kind?: 'area' | 'line' | 'bars'
}

// The legend marker reads the same variable, so a chart drawn in the revenue colour has a matching legend.
// How long the pointer rests on a sparkline before its values show.
const SPARK_TIP_DELAY_MS = 0
const PRIMARY = 'var(--analytik-primary-series, var(--analytik-series-1))'
const SECONDARY = 'var(--analytik-series-2)'
// Before ResizeObserver reports the real width (and in tests, where it never does).
const INITIAL_WIDTH = 640
const AXIS = { axisLine: false, tickLine: false, tick: { fill: 'var(--analytik-text-faint)', fontSize: 11 } } as const

function PlotTooltip({
  active,
  payload,
  label,
  formatTime,
  series,
}: TooltipContentProps & {
  formatTime: (ts: number) => string
  series: Record<string, [string, (v: number) => string]>
}) {
  if (!active || !payload.length) return null
  return (
    <div className="analytik-chart-tip">
      <span className="analytik-chart-tip-time">{formatTime(Number(label))}</span>
      {payload.map((item) => {
        const [name, format] = series[String(item.dataKey)] ?? ['', String]
        return (
          <span key={String(item.dataKey)} className="analytik-chart-tip-row" data-series={String(item.dataKey)}>
            <span>{name}</span>
            <strong>{format(Number(item.value))}</strong>
          </span>
        )
      })}
    </div>
  )
}

/** The visitors area with an optional revenue bar series, gradients, a gliding tooltip and an animated entrance. */
export function AreaPlot({
  rows,
  label,
  formatValue,
  formatAxis = formatValue,
  formatTime,
  secondary,
  hidden,
  height,
  kind = 'area',
}: AreaPlotProps) {
  const id = useId().replace(/:/g, '')
  const animate = !useReducedMotionConfig()
  const max = niceMax(Math.max(...rows.map((r) => Math.max(r.value, r.previous ?? 0))))
  const secondMax = niceMax(Math.max(...rows.map((r) => r.secondary ?? 0)))
  const series: Record<string, [string, (v: number) => string]> = {
    value: [label, formatValue],
    ...(secondary ? { secondary: [secondary.label, secondary.formatValue] as [string, (v: number) => string] } : {}),
    previous: [t('{label} (comparison)', { label }), formatValue],
  }

  return (
    <ResponsiveContainer width="100%" height={height} initialDimension={{ width: INITIAL_WIDTH, height }}>
      <ComposedChart
        data={rows}
        margin={{ top: 12, right: 4, bottom: 0, left: 0 }}
        aria-label={t('{label} chart', { label })}
      >
        <defs>
          <linearGradient id={`${id}-area`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={PRIMARY} stopOpacity={0.38} />
            <stop offset="100%" stopColor={PRIMARY} stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id={`${id}-bar`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SECONDARY} stopOpacity={0.95} />
            <stop offset="100%" stopColor={SECONDARY} stopOpacity={0.45} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 5" stroke="var(--analytik-border-strong)" />
        <XAxis dataKey="ts" {...AXIS} tickFormatter={formatTime} minTickGap={28} tickMargin={10} />
        <YAxis
          yAxisId="left"
          {...AXIS}
          domain={[0, max]}
          ticks={[0, max / 2, max]}
          tickFormatter={(v: number) => (v ? formatAxis(v) : '0')}
          width={56}
        />
        {secondary && (
          <YAxis
            yAxisId="right"
            orientation="right"
            {...AXIS}
            domain={[0, secondMax]}
            ticks={[0, secondMax / 2, secondMax]}
            tickFormatter={(v: number) => (v ? (secondary.formatAxis ?? secondary.formatValue)(v) : '0')}
            width={64}
          />
        )}
        <Tooltip
          cursor={{ stroke: 'var(--analytik-border-strong)', strokeDasharray: '4 4' }}
          content={(props) => <PlotTooltip {...props} formatTime={formatTime} series={series} />}
          isAnimationActive={animate}
          animationDuration={220}
          animationEasing="ease-out"
        />
        {secondary && !hidden.secondary && (
          <Bar
            yAxisId="right"
            dataKey="secondary"
            fill={`url(#${id}-bar)`}
            radius={[4, 4, 0, 0]}
            maxBarSize={14}
            isAnimationActive={animate}
            animationDuration={700}
            animationEasing="ease-out"
          />
        )}
        {!hidden.primary && rows.some((r) => r.previous !== undefined) && (
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="previous"
            stroke={PRIMARY}
            strokeOpacity={0.45}
            strokeWidth={2}
            strokeDasharray="5 4"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--analytik-surface)', fill: PRIMARY }}
            isAnimationActive={animate}
            animationDuration={900}
            animationEasing="ease-out"
          />
        )}
        {!hidden.primary && kind === 'bars' && (
          <Bar
            yAxisId="left"
            dataKey="value"
            fill={PRIMARY}
            radius={[4, 4, 0, 0]}
            maxBarSize={22}
            isAnimationActive={animate}
            animationDuration={700}
            animationEasing="ease-out"
          />
        )}
        {!hidden.primary && kind !== 'bars' && (
          <Area
            yAxisId="left"
            type="monotone"
            dataKey="value"
            stroke={PRIMARY}
            strokeWidth={2.25}
            fill={kind === 'line' ? 'none' : `url(#${id}-area)`}
            dot={false}
            activeDot={{ r: 5, strokeWidth: 2.5, stroke: 'var(--analytik-surface)', fill: PRIMARY }}
            isAnimationActive={animate}
            animationDuration={900}
            animationEasing="ease-out"
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export interface PlotSeries {
  key: string
  label: string
  kind: 'area' | 'line' | 'bars'
  colour: string
  /** Series with the same scale share an axis; the first scale is drawn on the left, the second on the right. */
  scale: string
  formatValue: (value: number) => string
  formatAxis: (value: number) => string
}

export interface MultiPlotProps {
  /** One row per bucket: `ts`, a value per series key and, with a comparison, one per `key:previous`. */
  rows: ({ ts: number } & Record<string, number>)[]
  series: PlotSeries[]
  formatTime: (ts: number) => string
  height: number
  label: string
}

function MultiTooltip({
  active,
  payload,
  label,
  formatTime,
  series,
}: TooltipContentProps & { formatTime: (ts: number) => string; series: PlotSeries[] }) {
  if (!active || !payload.length) return null
  const values = new Map(payload.map((item) => [String(item.dataKey), Number(item.value)]))
  return (
    <div className="analytik-chart-tip">
      <span className="analytik-chart-tip-time">{formatTime(Number(label))}</span>
      {series
        .filter((s) => values.has(s.key))
        .map((s) => (
          <span
            key={s.key}
            className="analytik-chart-tip-row"
            data-series="custom"
            style={{ '--analytik-tip-colour': s.colour } as CSSProperties}
          >
            <span>{s.label}</span>
            <strong>{s.formatValue(values.get(s.key) ?? 0)}</strong>
          </span>
        ))}
      {series
        .filter((s) => values.has(`${s.key}:previous`))
        .map((s) => (
          <span
            key={`${s.key}:previous`}
            className="analytik-chart-tip-row"
            data-series="custom"
            data-comparison=""
            style={{ '--analytik-tip-colour': s.colour } as CSSProperties}
          >
            <span>{t('{label} (comparison)', { label: s.label })}</span>
            <strong>{s.formatValue(values.get(`${s.key}:previous`) ?? 0)}</strong>
          </span>
        ))}
    </div>
  )
}

/**
 * Several metrics over one time axis: bars behind, areas and lines in front. Metrics of the same kind (counts, money,
 * rates, durations) share a scale; the first two scales get an axis each, any further one scales on its own.
 */
export function MultiPlot({ rows, series, formatTime, height, label }: MultiPlotProps) {
  const id = useId().replace(/:/g, '')
  const animate = !useReducedMotionConfig()
  const scales = [...new Set(series.map((s) => s.scale))]
  const top = (scale: string) =>
    niceMax(
      Math.max(
        0,
        ...series
          .filter((s) => s.scale === scale)
          .flatMap((s) => rows.flatMap((r) => [r[s.key] ?? 0, r[`${s.key}:previous`] ?? 0])),
      ),
    )
  const ordered = [...series].sort((a, b) => Number(b.kind === 'bars') - Number(a.kind === 'bars'))
  const bars = series.filter((s) => s.kind === 'bars').length

  return (
    <ResponsiveContainer width="100%" height={height} initialDimension={{ width: INITIAL_WIDTH, height }}>
      <ComposedChart
        data={rows}
        margin={{ top: 12, right: 4, bottom: 0, left: 0 }}
        aria-label={t('{label} chart', { label })}
      >
        <defs>
          {series.map((s, i) => (
            <linearGradient key={s.key} id={`${id}-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.colour} stopOpacity={s.kind === 'bars' ? 0.95 : 0.32} />
              <stop offset="100%" stopColor={s.colour} stopOpacity={s.kind === 'bars' ? 0.45 : 0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 5" stroke="var(--analytik-border-strong)" />
        <XAxis dataKey="ts" {...AXIS} tickFormatter={formatTime} minTickGap={28} tickMargin={10} />
        {scales.map((scale, i) => {
          const max = top(scale)
          const format = series.find((s) => s.scale === scale)?.formatAxis ?? String
          return (
            <YAxis
              key={scale}
              yAxisId={scale}
              orientation={i === 1 ? 'right' : 'left'}
              hide={i > 1}
              {...AXIS}
              domain={[0, max]}
              ticks={[0, max / 2, max]}
              tickFormatter={(v: number) => (v ? format(v) : '0')}
              width={i === 1 ? 64 : 56}
            />
          )
        })}
        <Tooltip
          cursor={{ stroke: 'var(--analytik-border-strong)', strokeDasharray: '4 4' }}
          content={(props) => <MultiTooltip {...props} formatTime={formatTime} series={series} />}
          isAnimationActive={animate}
          animationDuration={220}
          animationEasing="ease-out"
        />
        {series
          .filter((s) => rows.some((r) => `${s.key}:previous` in r))
          .map((s) => (
            <Line
              key={`${s.key}:previous`}
              yAxisId={s.scale}
              type="monotone"
              dataKey={`${s.key}:previous`}
              stroke={s.colour}
              strokeOpacity={0.45}
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--analytik-surface)', fill: s.colour }}
              isAnimationActive={animate}
              animationDuration={900}
              animationEasing="ease-out"
            />
          ))}
        {ordered.map((s) =>
          s.kind === 'bars' ? (
            <Bar
              key={s.key}
              yAxisId={s.scale}
              dataKey={s.key}
              fill={`url(#${id}-${series.indexOf(s)})`}
              radius={[4, 4, 0, 0]}
              maxBarSize={bars > 1 ? 10 : 14}
              isAnimationActive={animate}
              animationDuration={700}
              animationEasing="ease-out"
            />
          ) : (
            <Area
              key={s.key}
              yAxisId={s.scale}
              type="monotone"
              dataKey={s.key}
              stroke={s.colour}
              strokeWidth={2.25}
              fill={s.kind === 'line' ? 'none' : `url(#${id}-${series.indexOf(s)})`}
              dot={false}
              activeDot={{ r: 5, strokeWidth: 2.5, stroke: 'var(--analytik-surface)', fill: s.colour }}
              isAnimationActive={animate}
              animationDuration={900}
              animationEasing="ease-out"
            />
          ),
        )}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

/** The time and value of the sparkline point under the pointer, once the pointer has rested on the line. */
export function SparkTip({
  active,
  payload,
  details,
  shown,
}: Pick<TooltipContentProps, 'active' | 'payload'> & { details: SparkDetail[]; shown: boolean }) {
  const point = payload[0]?.payload as { i: number } | undefined
  const detail = point && details[point.i]
  if (!shown || !active || !detail) return null
  return (
    <div className="analytik-chart-tip">
      <span className="analytik-chart-tip-time">{detail.when}</span>
      <strong>{detail.value}</strong>
    </div>
  )
}

/** A tiny trend area without axes, for stat tiles. */
export function SparkPlot({ values, details }: { values: number[]; details?: SparkDetail[] }) {
  const id = useId().replace(/:/g, '')
  const animate = !useReducedMotionConfig()
  // The value shows only once the pointer has rested on the line for a moment, not as it passes over.
  const [shown, setShown] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const rest = (): void => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setShown(true), SPARK_TIP_DELAY_MS)
  }
  const leave = (): void => {
    clearTimeout(timer.current)
    setShown(false)
  }
  return (
    <div className="analytik-spark-plot" onMouseEnter={details && rest} onMouseLeave={details && leave}>
      <ResponsiveContainer width="100%" height={28} initialDimension={{ width: 120, height: 28 }}>
        <AreaChart data={values.map((value, i) => ({ i, value }))} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
          <defs>
            <linearGradient id={`${id}-spark`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.25} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
            </linearGradient>
          </defs>
          {details && (
            <Tooltip
              cursor={shown ? { stroke: 'var(--analytik-border-strong)', strokeDasharray: '3 3' } : false}
              content={(props) => <SparkTip {...props} details={details} shown={shown} />}
              allowEscapeViewBox={{ x: true, y: true }}
              wrapperStyle={{ zIndex: 5, pointerEvents: 'none' }}
              isAnimationActive={false}
            />
          )}
          <Area
            type="monotone"
            dataKey="value"
            stroke="currentColor"
            strokeWidth={1.5}
            fill={`url(#${id}-spark)`}
            dot={false}
            activeDot={details && shown ? { r: 3, strokeWidth: 0, fill: 'currentColor' } : false}
            isAnimationActive={animate}
            animationDuration={700}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
