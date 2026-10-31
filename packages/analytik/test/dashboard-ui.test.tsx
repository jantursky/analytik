import { MotionConfig } from 'motion/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { presetRange } from '../src/dashboard/range'
import { currencies } from '../src/dashboard/ui/currency'
import { formatMoney, formatMoneyShort } from '../src/dashboard/format'
import { FaviconsContext, SiteTile, StatTile } from '../src/dashboard/ui'
import { addDays, addMonths, monthGrid } from '../src/dashboard/ui/calendar'
import { DatePicker, DateRangePicker, rangeLabel } from '../src/dashboard/ui/date-picker'
import { AnimatedNumber } from '../src/dashboard/ui/motion'
import { Switch } from '../src/dashboard/ui/switch'
import { describeTimeZone, timeZones, zoneLabel } from '../src/dashboard/ui/timezone'
import { Tooltip } from '../src/dashboard/ui/tooltip'
import { pageNumbers } from '../src/dashboard/views/DataTable'
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

describe('pageNumbers', () => {
  it('shows the ends and the neighbours of the current page, with gaps', () => {
    expect(pageNumbers(0, 1)).toEqual([0])
    expect(pageNumbers(0, 3)).toEqual([0, 1, 2])
    expect(pageNumbers(0, 10)).toEqual([0, 1, null, 9])
    expect(pageNumbers(5, 10)).toEqual([0, null, 4, 5, 6, null, 9])
    expect(pageNumbers(9, 10)).toEqual([0, null, 8, 9])
    expect(pageNumbers(2, 10)).toEqual([0, 1, 2, 3, null, 9])
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
    expect(rangeLabel(presetRange('30d', Date.now()))).toBe('Past 30 days')
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

describe('SiteTile', () => {
  const site = { name: 'Shop', domain: 'shop.example.com' }
  const img = (container: Element) => container.querySelector<HTMLImageElement>('img.analytik-favicon')

  it('loads the favicon from the site itself and fades it in', async () => {
    localStorage.clear()
    const { container } = await render(<SiteTile site={site} />)
    expect(container.textContent).toBe('S')
    expect(img(container)?.getAttribute('src')).toBe('https://shop.example.com/favicon.ico')
    Object.defineProperty(img(container), 'naturalWidth', { value: 32 })
    await actAsync(() => img(container)?.dispatchEvent(new Event('load')))
    expect(img(container)?.hasAttribute('data-loaded')).toBe(true)
  })

  it('gives generated test sites the analytik mark in their own colours, without asking for a favicon', async () => {
    const colours = async (domain: string) => {
      const { container } = await render(<SiteTile site={{ name: 'Test site', domain }} />)
      expect(img(container)).toBeNull()
      expect(container.querySelector('.analytik-tile-mark .analytik-brand-mark')).not.toBeNull()
      return [...container.querySelectorAll('path[class^="analytik-brand"]')].map((p) => p.getAttribute('fill'))
    }
    const first = await colours('abc123.test.analytik.dev')
    expect(first).toHaveLength(2)
    expect(first[0]).not.toBe(first[1])
    expect(await colours('abc123.test.analytik.dev')).toEqual(first)
    const seen = new Set([String(first)])
    for (const id of ['q1', 'q2', 'q3', 'q4']) seen.add(String(await colours(`${id}.test.analytik.dev`)))
    expect(seen.size).toBeGreaterThan(1)
  })

  it('remembers a missing favicon and keeps the initial', async () => {
    localStorage.clear()
    const first = await render(<SiteTile site={site} />)
    await actAsync(() => img(first.container)?.dispatchEvent(new Event('error')))
    expect(img(first.container)).toBeNull()
    const second = await render(<SiteTile site={site} />)
    expect(img(second.container)).toBeNull()
    const blank = await render(<SiteTile site={{ ...site, domain: 'blank.example.com' }} />)
    await actAsync(() => img(blank.container)?.dispatchEvent(new Event('load')))
    expect(img(blank.container)).toBeNull()
  })

  it('skips local hosts and can be switched off', async () => {
    const local = await render(<SiteTile site={{ name: '', domain: 'localhost:3000' }} />)
    expect(img(local.container)).toBeNull()
    expect(local.container.textContent).toBe('L')
    const off = await render(
      <FaviconsContext value={false}>
        <SiteTile site={{ ...site, domain: 'other.example.org' }} />
      </FaviconsContext>,
    )
    expect(img(off.container)).toBeNull()
    const own = await render(
      <FaviconsContext value={(s) => (s.name === 'Shop' ? '/shop.png' : undefined)}>
        <SiteTile site={site} />
        <SiteTile site={{ name: 'Blog', domain: 'blog.example.com' }} />
      </FaviconsContext>,
    )
    expect([...own.container.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual(['/shop.png'])
  })
})

describe('currencies', () => {
  it('lists every currency with its name and symbol, in alphabetical order of code', () => {
    const list = [...currencies().values()]
    expect(list.length).toBeGreaterThan(100)
    const codes = list.map((c) => c.code)
    expect(codes).toEqual([...codes].sort())
    // The runtime decides which codes exist (Bun on Linux also lists retired ones such as ADP), so only the order is fixed.
    expect(codes.indexOf('AED')).toBeLessThan(codes.indexOf('EUR'))
    expect(codes.indexOf('EUR')).toBeLessThan(codes.indexOf('USD'))
    expect(currencies().get('EUR')).toEqual({ code: 'EUR', name: 'Euro', symbol: '€' })
    expect(new Set(list.map((c) => c.code)).size).toBe(list.length)
  })
})

describe('time zones', () => {
  it('names a zone by its city and region, with the offset and the time there', () => {
    expect(zoneLabel('America/Argentina/Buenos_Aires')).toBe('Buenos Aires, America')
    expect(zoneLabel('UTC')).toBe('UTC')
    const winter = new Date(Date.UTC(2026, 0, 15, 12, 0))
    expect(describeTimeZone('Europe/Bratislava', winter)).toEqual({
      zone: 'Europe/Bratislava',
      offset: 'UTC+01:00',
      minutes: 60,
      name: 'Central European Standard Time',
      time: '13:00',
    })
    expect(describeTimeZone('Asia/Kolkata', winter)).toMatchObject({ offset: 'UTC+05:30', minutes: 330 })
    expect(describeTimeZone('America/New_York', winter)).toMatchObject({ offset: 'UTC-05:00', minutes: -300 })
    expect(describeTimeZone('UTC', winter)).toMatchObject({ offset: 'UTC', minutes: 0, time: '12:00' })
    expect(describeTimeZone('Not/A_Zone', winter)).toEqual({
      zone: 'Not/A_Zone',
      offset: '',
      minutes: 0,
      name: 'Not/A_Zone',
      time: '',
    })
    expect(timeZones()[0]).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
  })
})

describe('Shortened', () => {
  it('marks a compact number and keeps the exact one for hover and screen readers', async () => {
    const { container } = await render(
      <StatTile
        label="Revenue"
        delta={{ value: 10109800, previous: 0, change: null }}
        format={(v) => formatMoneyShort(v, 'USD')}
        exact={(v) => formatMoney(v, 'USD')}
      />,
    )
    expect(container.querySelector('.analytik-stat-value')?.textContent).toBe('$101.1K(exactly $101,098.00)')
    expect(container.querySelector('.analytik-shortened .analytik-icon')).not.toBeNull()
    const small = await render(
      <StatTile
        label="Revenue"
        delta={{ value: 155, previous: 0, change: null }}
        format={(v) => formatMoneyShort(v, 'USD')}
        exact={(v) => formatMoney(v, 'USD')}
      />,
    )
    expect(small.container.querySelector('.analytik-shortened')).toBeNull()
    expect(formatMoneyShort(100, 'XXX-bad')).toBe(formatMoney(100, 'XXX-bad'))
    expect(formatMoneyShort(150000000, 'JPY')).toBe('¥150M')
  })
})
