import { useId, useState } from 'react'

import { formatDayRange } from '../format'
import { Icon } from '../icons'
import { customRange, type DateRange, presetRange, RANGE_PRESETS, type RangePreset, toDateInput } from '../range'
import { Calendar, type IsoDay } from './calendar'
import { Popover } from './popover'

type Preset = Exclude<RangePreset, 'custom'>

const PRESETS = RANGE_PRESETS.filter((p): p is { value: Preset; label: string } => p.value !== 'custom')
const dayStart = (day: IsoDay): number => new Date(`${day}T00:00:00`).getTime()

/** What the range trigger says: the preset's name, or the days a custom range covers. */
export function rangeLabel(range: DateRange): string {
  if (range.preset !== 'custom') return RANGE_PRESETS.find((p) => p.value === range.preset)?.label ?? range.preset
  return formatDayRange(range.from, range.to - 1)
}

interface Draft {
  start: IsoDay | null
  end: IsoDay | null
}

/** A preset list and a calendar in one popover. Presets apply at once; a picked range applies with "Apply". */
export function DateRangePicker({ range, onChange }: { range: DateRange; onChange: (range: DateRange) => void }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>({ start: null, end: null })
  const [month, setMonth] = useState(() => toDateInput(range.to - 1))
  const [today, setToday] = useState('')

  const toggle = (next: boolean): void => {
    if (next) {
      const end = toDateInput(range.to - 1)
      setToday(toDateInput(Date.now()))
      setDraft({ start: toDateInput(range.from), end })
      setMonth(end)
    }
    setOpen(next)
  }
  const select = (day: IsoDay): void => {
    const { start, end } = draft
    if (!start || end) setDraft({ start: day, end: null })
    else setDraft(day < start ? { start: day, end: start } : { start, end: day })
  }
  const apply = (next: DateRange | null): void => {
    if (!next) return
    onChange(next)
    setOpen(false)
  }
  const { start, end } = draft
  const summary = start ? formatDayRange(dayStart(start), dayStart(end ?? start)) : 'Pick the first day'

  return (
    <Popover
      open={open}
      onOpenChange={toggle}
      label="Choose a date range"
      className="analytik-range-popup"
      trigger={
        <button type="button" className="analytik-range-trigger">
          <Icon name="calendar" />
          <span>{rangeLabel(range)}</span>
        </button>
      }
    >
      <ul className="analytik-presets" aria-label="Presets">
        {PRESETS.map((preset) => (
          <li key={preset.value}>
            <button
              type="button"
              className="analytik-preset"
              aria-pressed={range.preset === preset.value}
              onClick={() => apply(presetRange(preset.value, Date.now()))}
            >
              {preset.label}
            </button>
          </li>
        ))}
      </ul>
      <div className="analytik-range-custom">
        <Calendar month={month} onMonthChange={setMonth} start={start} end={end} onSelect={select} today={today} />
        <div className="analytik-range-foot">
          <span className="analytik-muted" aria-live="polite">
            {summary}
          </span>
          <button
            type="button"
            className="analytik-button"
            data-variant="primary"
            disabled={!start}
            onClick={() => apply(start ? customRange(start, end ?? start) : null)}
          >
            Apply
          </button>
        </div>
      </div>
    </Popover>
  )
}

export interface DatePickerProps {
  label: string
  /** `YYYY-MM-DD`, or empty when no day is picked. */
  value: string
  onChange: (day: IsoDay) => void
}

/** One day picked from a calendar popover, e.g. a cut-off date. */
export function DatePicker({ label, value, onChange }: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const [today, setToday] = useState('')
  const [month, setMonth] = useState(value)
  const toggle = (next: boolean): void => {
    if (next) {
      const now = toDateInput(Date.now())
      setToday(now)
      setMonth(value || now)
    }
    setOpen(next)
  }
  const labelId = useId()
  const valueId = useId()
  return (
    <div className="analytik-field">
      <span className="analytik-field-label" id={labelId}>
        {label}
      </span>
      <Popover
        open={open}
        onOpenChange={toggle}
        label={label}
        className="analytik-date-popup"
        trigger={
          <button
            type="button"
            className="analytik-input analytik-date-trigger"
            aria-labelledby={`${labelId} ${valueId}`}
          >
            <Icon name="calendar" />
            <span id={valueId}>{value ? formatDayRange(dayStart(value), dayStart(value)) : 'Pick a date'}</span>
          </button>
        }
      >
        <Calendar
          month={month}
          onMonthChange={setMonth}
          start={value || null}
          end={value || null}
          onSelect={(day) => {
            onChange(day)
            setOpen(false)
          }}
          today={today}
        />
      </Popover>
    </div>
  )
}
