import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'

import type { Filters, Interval } from '../shared/types'
import { Icon } from './icons'
import { msg, t } from './i18n'
import { type DateRange, intervalsFor, shiftRange } from './range'
import { DateRangePicker } from './ui/date-picker'
import { Select } from './ui/select'

/** Previous and next period arrows around a date range popover with presets and a calendar. */
export function RangePicker({ range, onChange }: { range: DateRange; onChange: (range: DateRange) => void }) {
  // Only decides whether "Next" starts enabled; stepping itself reads the clock.
  const [openedAt] = useState(() => Date.now())
  const step = (direction: -1 | 1): void => {
    const next = shiftRange(range, direction, Date.now())
    if (next) onChange(next)
  }
  return (
    <div className="analytik-range">
      <button type="button" className="analytik-pill-icon" aria-label={t('Previous period')} onClick={() => step(-1)}>
        <Icon name="prev" />
      </button>
      <DateRangePicker range={range} onChange={onChange} />
      <button
        type="button"
        className="analytik-pill-icon"
        aria-label={t('Next period')}
        disabled={!shiftRange(range, 1, openedAt)}
        onClick={() => step(1)}
      >
        <Icon name="next" />
      </button>
    </div>
  )
}

const INTERVAL_LABELS: Record<Interval, string> = {
  hour: msg('By hour'),
  day: msg('By day'),
  week: msg('By week'),
  month: msg('By month'),
}

/** Bucket size of the chart, limited to the ones that suit the range. */
export function IntervalPicker({ range, onChange }: { range: DateRange; onChange: (range: DateRange) => void }) {
  return (
    <Select
      label={t('Interval')}
      hideLabel
      className="analytik-pill"
      value={range.interval}
      options={intervalsFor(range.from, range.to).map((value) => ({ value, label: t(INTERVAL_LABELS[value]) }))}
      onChange={(interval) => onChange({ ...range, interval })}
    />
  )
}

export function FilterBar({ filters, onChange }: { filters: Filters; onChange: (filters: Filters) => void }) {
  const entries = Object.entries(filters).filter((entry): entry is [string, string] => entry[1] != null)
  return (
    <AnimatePresence initial={false}>
      {entries.length > 0 && (
        <motion.div
          className="analytik-filters"
          role="group"
          aria-label={t('Active filters')}
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
        >
          <AnimatePresence initial={false} mode="popLayout">
            {entries.map(([dimension, value]) => (
              <motion.button
                key={dimension}
                layout
                type="button"
                className="analytik-chip"
                aria-label={t('Remove filter {dimension} is {value}', { dimension, value })}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                onClick={() => onChange(Object.fromEntries(entries.filter(([d]) => d !== dimension)))}
              >
                <span className="analytik-muted">{dimension}</span> {value || t('(none)')}{' '}
                <span aria-hidden="true">×</span>
              </motion.button>
            ))}
          </AnimatePresence>
          {entries.length > 1 && (
            <button type="button" className="analytik-link" onClick={() => onChange({})}>
              {t('Clear all')}
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
