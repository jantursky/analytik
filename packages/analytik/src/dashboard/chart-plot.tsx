// Loaded on demand by charts.tsx, so Recharts stays out of the first dashboard bundle.
import { useReducedMotionConfig } from 'motion/react'
import { useId } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from 'recharts'

import { niceMax } from './scale'

export interface PlotRow {
  ts: number
  value: number
  secondary?: number
}

export interface AreaPlotProps {
  rows: PlotRow[]
  label: string
  formatValue: (value: number) => string
  formatTime: (ts: number) => string
  /** Present when there is a second series; drawn as bars against the right axis. */
  secondary?: { label: string; formatValue: (value: number) => string }
  /** Series switched off in the legend. */
  hidden: { primary: boolean; secondary: boolean }
  height: number
}

const PRIMARY = 'var(--analytik-series-1)'
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
export function AreaPlot({ rows, label, formatValue, formatTime, secondary, hidden, height }: AreaPlotProps) {
  const id = useId().replace(/:/g, '')
  const animate = !useReducedMotionConfig()
  const max = niceMax(Math.max(...rows.map((r) => r.value)))
  const secondMax = niceMax(Math.max(...rows.map((r) => r.secondary ?? 0)))
  const series: Record<string, [string, (v: number) => string]> = {
    value: [label, formatValue],
    ...(secondary ? { secondary: [secondary.label, secondary.formatValue] as [string, (v: number) => string] } : {}),
  }

  return (
    <ResponsiveContainer width="100%" height={height} initialDimension={{ width: INITIAL_WIDTH, height }}>
      <ComposedChart data={rows} margin={{ top: 12, right: 4, bottom: 0, left: 0 }} aria-label={`${label} chart`}>
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
          tickFormatter={(v: number) => (v ? formatValue(v) : '0')}
          width={56}
        />
        {secondary && (
          <YAxis
            yAxisId="right"
            orientation="right"
            {...AXIS}
            domain={[0, secondMax]}
            ticks={[0, secondMax / 2, secondMax]}
            tickFormatter={(v: number) => (v ? secondary.formatValue(v) : '0')}
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
        {!hidden.primary && (
          <Area
            yAxisId="left"
            type="monotone"
            dataKey="value"
            stroke={PRIMARY}
            strokeWidth={2.25}
            fill={`url(#${id}-area)`}
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

/** A tiny trend area without axes, for stat tiles. */
export function SparkPlot({ values }: { values: number[] }) {
  const id = useId().replace(/:/g, '')
  const animate = !useReducedMotionConfig()
  return (
    <ResponsiveContainer width="100%" height={28} initialDimension={{ width: 120, height: 28 }}>
      <AreaChart data={values.map((value, i) => ({ i, value }))} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
        <defs>
          <linearGradient id={`${id}-spark`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity={0.25} />
            <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="value"
          stroke="currentColor"
          strokeWidth={1.5}
          fill={`url(#${id}-spark)`}
          dot={false}
          isAnimationActive={animate}
          animationDuration={700}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
