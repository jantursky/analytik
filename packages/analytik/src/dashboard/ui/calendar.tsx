import { type KeyboardEvent, useEffect, useRef, useState } from 'react'

import { Icon } from '../icons'
import { toDateInput } from '../range'

/** A local calendar day as `YYYY-MM-DD`; these sort and compare correctly as strings. */
export type IsoDay = string

const LOCALE = 'en-US'

const toDate = (day: IsoDay): Date => {
  const [y = 1970, m = 1, d = 1] = day.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(day: IsoDay, days: number): IsoDay {
  const date = toDate(day)
  date.setDate(date.getDate() + days)
  return toDateInput(date.getTime())
}

/** The first day of the month `months` away from the month of `day`. */
export function addMonths(day: IsoDay, months: number): IsoDay {
  const date = toDate(day)
  return toDateInput(new Date(date.getFullYear(), date.getMonth() + months, 1).getTime())
}

/** Six Monday-first weeks covering the month of `day`, with the neighbouring months' days filling the gaps. */
export function monthGrid(day: IsoDay): IsoDay[][] {
  const first = addMonths(day, 0)
  const offset = (toDate(first).getDay() + 6) % 7
  const start = addDays(first, -offset)
  return Array.from({ length: 6 }, (_, week) => Array.from({ length: 7 }, (_, d) => addDays(start, week * 7 + d)))
}

const monthTitle = new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' })
const dayName = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export interface CalendarProps {
  /** Any day of the month shown. */
  month: IsoDay
  onMonthChange: (month: IsoDay) => void
  /** Selected day, or the start of the selected range. */
  start: IsoDay | null
  /** End of the selected range; `null` while only the start is picked. */
  end: IsoDay | null
  onSelect: (day: IsoDay) => void
  /** Marked with a dot; also the last selectable day. */
  today: IsoDay
}

/**
 * A month grid. Keyboard: arrows move by day and week, Home and End to the week's ends, Page Up and Page Down by
 * month, Enter or Space selects. While a range has a start but no end, hovering previews it.
 */
export function Calendar({ month, onMonthChange, start, end, onSelect, today }: CalendarProps) {
  const [hover, setHover] = useState<IsoDay | null>(null)
  const [focused, setFocused] = useState<IsoDay>(() => end ?? start ?? month)
  const grid = useRef<HTMLTableElement>(null)
  const moved = useRef(false)
  const first = addMonths(month, 0)
  const weeks = monthGrid(first)
  const inMonth = (day: IsoDay): boolean => day.slice(0, 7) === first.slice(0, 7)
  const focusDay = inMonth(focused) ? focused : first
  const rangeEnd = end ?? (start && hover && hover > start ? hover : null)

  useEffect(() => {
    if (!moved.current) return
    moved.current = false
    grid.current?.querySelector<HTMLElement>(`[data-day="${focusDay}"]`)?.focus()
  }, [focusDay])

  const move = (day: IsoDay): void => {
    moved.current = true
    setFocused(day)
    if (!inMonth(day)) onMonthChange(day)
  }
  const onKeyDown = (event: KeyboardEvent): void => {
    const weekday = (toDate(focusDay).getDay() + 6) % 7
    const next = {
      ArrowLeft: addDays(focusDay, -1),
      ArrowRight: addDays(focusDay, 1),
      ArrowUp: addDays(focusDay, -7),
      ArrowDown: addDays(focusDay, 7),
      Home: addDays(focusDay, -weekday),
      End: addDays(focusDay, 6 - weekday),
      PageUp: addMonths(focusDay, -1),
      PageDown: addMonths(focusDay, 1),
    }[event.key]
    if (!next) return
    event.preventDefault()
    move(next)
  }

  const title = monthTitle.format(toDate(first))
  const nextMonth = addMonths(first, 1)
  return (
    <div className="analytik-calendar">
      <div className="analytik-calendar-head">
        <button
          type="button"
          className="analytik-pill-icon"
          aria-label="Previous month"
          onClick={() => onMonthChange(addMonths(first, -1))}
        >
          <Icon name="prev" />
        </button>
        <span className="analytik-calendar-title" aria-live="polite">
          {title}
        </span>
        <button
          type="button"
          className="analytik-pill-icon"
          aria-label="Next month"
          disabled={nextMonth > today}
          onClick={() => onMonthChange(nextMonth)}
        >
          <Icon name="next" />
        </button>
      </div>
      <table role="grid" aria-label={title} ref={grid} onKeyDown={onKeyDown} onMouseLeave={() => setHover(null)}>
        <thead>
          <tr>
            {WEEKDAYS.map((name, i) => (
              <th key={name} scope="col" abbr={WEEKDAY_NAMES[i]}>
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]}>
              {week.map((day) => {
                const selected = day === start || day === end
                const between = !!start && !!rangeEnd && day > start && day < rangeEnd
                return (
                  <td key={day} role="gridcell" aria-selected={selected || between}>
                    <button
                      type="button"
                      className="analytik-day"
                      data-day={day}
                      data-outside={inMonth(day) ? undefined : ''}
                      data-today={day === today ? '' : undefined}
                      data-edge={selected || day === rangeEnd ? '' : undefined}
                      data-between={between ? '' : undefined}
                      tabIndex={day === focusDay ? 0 : -1}
                      disabled={day > today}
                      aria-label={dayName.format(toDate(day))}
                      onClick={() => onSelect(day)}
                      onMouseEnter={() => setHover(day)}
                      onFocus={() => setFocused(day)}
                    >
                      {Number(day.slice(8))}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
