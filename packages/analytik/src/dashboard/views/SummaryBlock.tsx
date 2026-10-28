import { motion } from 'motion/react'
import { useState } from 'react'

import { MultiChart } from '../charts'
import { useDashboard } from '../context'
import { formatBucket, formatNumber } from '../format'
import { Icon } from '../icons'
import { t } from '../i18n'
import { usePreferences } from '../preferences'
import { Shortened, StatTile, Status } from '../ui'
import { AnimatedNumber, rise } from '../ui/motion'
import { Select } from '../ui/select'
import {
  exactMetric,
  formatMetric,
  MAX_SERIES,
  MAX_STATS,
  METRIC_KEYS,
  METRICS,
  type MetricKey,
  parseSummary,
  seriesColour,
  STAT_KEYS,
  type StatKey,
  statLabel,
  type SummaryConfig,
} from './metrics'
import { useOverview } from './useOverview'

/** Lists labels the way a sentence would: "Visitors, Revenue and Bounce rate". */
const listOf = (keys: MetricKey[]): string => {
  const labels = keys.map((key) => t(METRICS[key].label))
  return labels.length > 1
    ? t('{list} and {last}', { list: labels.slice(0, -1).join(', '), last: labels.at(-1) ?? '' })
    : (labels[0] ?? '')
}

/**
 * The headline numbers over a chart. A click on a number plots it on its own, drawn the way it reads best (an area
 * for counts, bars for money and durations, a line for rates); clicking more numbers adds them to the same chart, up
 * to four, and clicking a plotted one takes it out again. While the overview is customized, each number can be
 * swapped, removed or added, and the metrics the chart combines by default can be picked.
 */
export function SummaryBlock({ editing }: { editing: boolean }) {
  const { site, range, openView } = useDashboard()
  const { overview, series } = useOverview()
  const { values, update } = usePreferences()
  const config = parseSummary(values.summary)
  // The numbers picked by clicking; null shows the chart the summary is configured with.
  const [picked, setPicked] = useState<MetricKey[] | null>(null)
  const data = overview.data
  const currency = data?.currency ?? site.currency
  const points = series.data ?? []
  const save = (next: Partial<SummaryConfig>): void => update({ summary: { ...config, ...next } })
  const focus = editing ? null : picked
  const plotted = focus ?? config.chart

  const unused = STAT_KEYS.filter((key) => !config.stats.includes(key))
  const setStat = (index: number, key: StatKey): void =>
    save({ stats: config.stats.map((current, i) => (i === index ? key : current)) })
  const pick = (key: MetricKey): void => {
    if (!picked) setPicked([key])
    else if (picked.includes(key)) setPicked(picked.length > 1 ? picked.filter((k) => k !== key) : null)
    else if (picked.length < MAX_SERIES) setPicked([...picked, key])
  }
  const toggleSeries = (key: MetricKey): void =>
    save({ chart: config.chart.includes(key) ? config.chart.filter((k) => k !== key) : [...config.chart, key] })

  // Only the first area stays filled; more areas over it would hide each other, so they are drawn as lines.
  const firstArea = plotted.find((key) => METRICS[key].kind === 'area')
  const chart = (
    <MultiChart
      key={plotted.join('-')}
      times={points.map((p) => p.ts)}
      series={plotted.map((key, index) => ({
        key,
        label: t(METRICS[key].label),
        values: points.map((p) => p[key]),
        kind: METRICS[key].kind === 'area' && key !== firstArea ? 'line' : METRICS[key].kind,
        colour: seriesColour(index),
        scale: METRICS[key].unit,
        formatValue: exactMetric(key, currency),
        formatAxis: formatMetric(key, currency),
      }))}
      formatTime={(ts) => formatBucket(ts, range.interval, site.timezone)}
      height={260}
    />
  )

  return (
    <motion.section
      className="analytik-card analytik-overview"
      aria-label={t('Summary')}
      variants={rise}
      data-editing={editing ? '' : undefined}
    >
      <Status loading={overview.loading && !data} error={overview.error}>
        {data && (
          <div className="analytik-stats">
            {config.stats.map((key, index) =>
              editing ? (
                <div key={key} className="analytik-stat analytik-stat-edit">
                  <Select
                    label={t('Number {number}', { number: index + 1 })}
                    hideLabel
                    className="analytik-pill"
                    value={key}
                    options={[key, ...unused].map((k) => ({ value: k, label: statLabel(k) }))}
                    onChange={(next) => setStat(index, next)}
                  />
                  <span className="analytik-stat-value">
                    {key === 'online' ? (
                      formatNumber(data.online)
                    ) : (
                      <Shortened
                        shown={formatMetric(key, currency)(data[key].value)}
                        exact={exactMetric(key, currency)(data[key].value)}
                      >
                        {formatMetric(key, currency)(data[key].value)}
                      </Shortened>
                    )}
                  </span>
                  <button
                    type="button"
                    className="analytik-pill-icon"
                    aria-label={t('Remove {name}', { name: statLabel(key) })}
                    disabled={config.stats.length === 1}
                    onClick={() => save({ stats: config.stats.filter((_, i) => i !== index) })}
                  >
                    <Icon name="trash" />
                  </button>
                </div>
              ) : key === 'online' ? (
                <div key={key} className="analytik-stat">
                  <span className="analytik-stat-label">
                    <span className="analytik-live-dot" data-idle={data.online ? undefined : ''} aria-hidden="true" />
                    {t('Live now')}
                  </span>
                  <span className="analytik-stat-value">
                    <AnimatedNumber value={data.online} format={formatNumber} />
                  </span>
                  {openView && (
                    <button type="button" className="analytik-link" onClick={() => openView('realtime')}>
                      {t('Open live map')}
                    </button>
                  )}
                </div>
              ) : (
                <StatTile
                  key={key}
                  label={t(METRICS[key].label)}
                  delta={data[key]}
                  format={formatMetric(key, currency)}
                  exact={exactMetric(key, currency)}
                  invert={METRICS[key].invert}
                  marker={plotted.includes(key) ? seriesColour(plotted.indexOf(key)) : undefined}
                  selected={focus?.includes(key) ?? false}
                  onSelect={() => pick(key)}
                />
              ),
            )}
            {editing && config.stats.length < MAX_STATS && unused.length > 0 && (
              <button
                type="button"
                className="analytik-stat analytik-stat-add"
                onClick={() => save({ stats: [...config.stats, unused[0] ?? 'visitors'] })}
              >
                <Icon name="plus" />
                {t('Add a number')}
              </button>
            )}
          </div>
        )}
      </Status>
      {editing && (
        <fieldset className="analytik-chart-edit">
          <legend className="analytik-field-label">
            {t('Chart')}{' '}
            <span className="analytik-field-hint">{t('up to {count}, shown together', { count: MAX_SERIES })}</span>
          </legend>
          {METRIC_KEYS.map((key) => {
            const on = config.chart.includes(key)
            return (
              <button
                key={key}
                type="button"
                className="analytik-chip"
                aria-pressed={on}
                disabled={on ? config.chart.length === 1 : config.chart.length >= MAX_SERIES}
                onClick={() => toggleSeries(key)}
              >
                {on && (
                  <span
                    className="analytik-marker"
                    style={{ background: seriesColour(config.chart.indexOf(key)) }}
                    aria-hidden="true"
                  />
                )}
                {t(METRICS[key].label)}
              </button>
            )
          })}
        </fieldset>
      )}
      {focus && (
        <div className="analytik-chart-focus">
          <strong>{t('{metrics} over time', { metrics: listOf(focus) })}</strong>
          <span className="analytik-field-hint">
            {focus.length < MAX_SERIES
              ? t('Click more numbers to compare them.')
              : t('Up to {count} at once.', { count: MAX_SERIES })}
          </span>
          <button type="button" className="analytik-link" onClick={() => setPicked(null)}>
            {t('Back to {metrics}', { metrics: listOf(config.chart).toLowerCase() })}
          </button>
        </div>
      )}
      <Status loading={series.loading && !series.data} error={series.error}>
        {chart}
      </Status>
    </motion.section>
  )
}
