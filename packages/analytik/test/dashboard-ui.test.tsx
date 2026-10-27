import { MotionConfig } from 'motion/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { presetRange } from '../src/dashboard/range'
import { addDays, addMonths, monthGrid } from '../src/dashboard/ui/calendar'
import { DatePicker, DateRangePicker, rangeLabel } from '../src/dashboard/ui/date-picker'
import { AnimatedNumber } from '../src/dashboard/ui/motion'
import { Switch } from '../src/dashboard/ui/switch'
import { Tooltip } from '../src/dashboard/ui/tooltip'
import { waitFor } from './dashboard-helpers'
import { actAsync, byText, click, render, settled } from './react-render'

describe('calendar maths', () => {
  it('builds six Monday-first weeks and steps across months', () => {
    const grid = monthGrid('2026-02-14')
    expect(grid).toHaveLength(6)
    expect(grid[0]).toEqual([
      '2026-01-26',
      '2026-01-27',
      '2026-01-28',
      '2026-01-29',
      '2026-01-30',
      '2026-01-31',
      '2026-02-01',
    ])
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-01')
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-01')
  })
})

describe('AnimatedNumber', () => {
  function Counter({ reduced }: { reduced: 'never' | 'always' }) {
    const [value, setValue] = useState(1)
    return (
      <MotionConfig reducedMotion={reduced}>
        <button type="button" onClick={() => setValue(value * 10)}>
          <AnimatedNumber value={value} format={(v) => v.toFixed(0)} />
        </button>
      </MotionConfig>
    )
  }

  it.each(['never', 'always'] as const)('lands on each new value (reduced motion: %s)', async (reduced) => {
    const { container } = await render(<Counter reduced={reduced} />)
    const button = container.querySelector('button')
    expect(button?.textContent).toBe('1')
    await click(button)
    await settled()
    expect(button?.textContent).toBe('10')
    await click(button)
    await settled()
    expect(button?.textContent).toBe('100')
  })
})

describe('Switch', () => {
  it('toggles from the switch and from its text, unless disabled', async () => {
    const onChange = vi.fn()
    const { container, rerender } = await render(
      <Switch checked={false} onChange={onChange}>
        Live
      </Switch>,
    )
    await click(container.querySelector('[role="switch"]'))
    await click(container.querySelector('.analytik-switch-field > span'))
    expect(onChange.mock.calls).toEqual([[true], [true]])
    await rerender(
      <Switch checked={false} onChange={onChange} disabled>
        Live
      </Switch>,
    )
    await click(container.querySelector('.analytik-switch-field > span'))
    expect(onChange).toHaveBeenCalledTimes(2)
  })
})

describe('date pickers', () => {
  it('labels ranges by preset or by their days', () => {
    expect(rangeLabel(presetRange('30d', Date.now()))).toBe('Last 30 days')
    expect(
      rangeLabel({
        preset: 'custom',
        from: new Date(2026, 0, 1).getTime(),
        to: new Date(2026, 0, 2).getTime(),
        interval: 'day',
      }),
    ).toBe('Jan 1, 2026')
  })

  it('applies a single day and reverses a range picked backwards', async () => {
    const onChange = vi.fn()
    const range = presetRange('7d', Date.now())
    const { container } = await render(<DateRangePicker range={range} onChange={onChange} />)
    await click(container.querySelector('.analytik-range-trigger'))
    await settled()
    const days = [...document.querySelectorAll<HTMLElement>('.analytik-day:not([data-outside]):not(:disabled)')]
    await click(days[3])
    await click(days[1])
    await click(byText(document.body, 'Apply', 'button'))
    const picked = onChange.mock.calls[0]?.[0] as { from: number; to: number }
    expect(new Date(picked.from).getDate()).toBe(Number(days[1]?.textContent))
    await click(container.querySelector('.analytik-range-trigger'))
    await settled()
    const again = [...document.querySelectorAll<HTMLElement>('.analytik-day:not([data-outside]):not(:disabled)')]
    await click(again[2])
    await click(byText(document.body, 'Apply', 'button'))
    const single = onChange.mock.calls[1]?.[0] as { from: number; to: number }
    expect(new Date(single.to - 1).getDate()).toBe(Number(again[2]?.textContent))
  })

  it('picks one day for a field', async () => {
    function Field() {
      const [day, setDay] = useState('2026-01-10')
      return <DatePicker label="Since" value={day} onChange={setDay} />
    }
    const { container } = await render(<Field />)
    const trigger = container.querySelector('.analytik-date-trigger')
    expect(trigger?.textContent).toBe('Jan 10, 2026')
    await click(trigger)
    await settled()
    expect(document.querySelector('.analytik-calendar-title')?.textContent).toBe('January 2026')
    await click(document.querySelector('[data-day="2026-01-12"]'))
    await settled()
    expect(trigger?.textContent).toBe('Jan 12, 2026')
  })
})

describe('Tooltip', () => {
  it('shows its label on hover', async () => {
    const { container } = await render(
      <Tooltip label="Refresh">
        <button type="button" aria-label="Refresh" />
      </Tooltip>,
    )
    const button = container.querySelector('button')!
    await actAsync(() => {
      button.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }))
      button.dispatchEvent(new MouseEvent('mouseenter'))
      button.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', bubbles: true }))
      button.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
      button.dispatchEvent(new FocusEvent('focus'))
    })
    const tip = await waitFor(() => document.querySelector('.analytik-tooltip'), 80)
    expect(tip.textContent).toBe('Refresh')
  })
})
