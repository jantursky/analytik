import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { AreaChart, MultiChart } from '../src/dashboard/charts'
import { waitFor } from './dashboard-helpers'
import { actAsync, key, render } from './react-render'

const points = [10, 40, 20, 30].map((value, i) => ({ ts: i, value }))
const formatTime = (ts: number): string => `day ${ts}`
const series = [
  {
    key: 'visitors',
    label: 'Visitors',
    values: [10, 40, 20, 30],
    kind: 'area' as const,
    colour: 'red',
    scale: 'count',
    formatValue: (v: number) => `${v} v`,
  },
]

const charts = {
  AreaChart: () => <AreaChart points={points} label="Visitors" formatValue={(v) => `${v} v`} formatTime={formatTime} />,
  MultiChart: () => <MultiChart times={[0, 1, 2, 3]} series={series} formatTime={formatTime} height={200} />,
}

/** The date the open tooltip names, or null while none is open. */
const readout = (container: Element): string | null =>
  container.querySelector('.analytik-chart-tip-time')?.textContent ?? null

describe.each(Object.entries(charts))('%s keyboard use', (_name, chart) => {
  it('is reachable with Tab and has an accessible name', async () => {
    const { container } = await render(chart())
    const surface = await waitFor(() => container.querySelector('.recharts-surface'))
    expect(surface.getAttribute('aria-label')).toBe('Visitors chart')
    expect(surface.getAttribute('tabindex')).toBe('0')
  })

  it('steps between points with ArrowRight and ArrowLeft and reads each value', async () => {
    const { container } = await render(chart())
    const surface = await waitFor(() => container.querySelector('.recharts-surface'))
    await actAsync(() => surface.dispatchEvent(new FocusEvent('focus')))
    await key(surface, 'ArrowRight')
    const first = await waitFor(() => readout(container))
    await key(surface, 'ArrowRight')
    const second = await waitFor(() => {
      const now = readout(container)
      return now !== first ? now : null
    })
    expect(Number(second.slice(4))).toBe(Number(first.slice(4)) + 1)
    await key(surface, 'ArrowLeft')
    await waitFor(() => (readout(container) === first ? first : null))
    expect(container.querySelector('.analytik-chart-tip-row')?.textContent).toMatch(/^Visitors\d+ v$/)
  })

  it('lets Tab leave the chart instead of trapping focus', async () => {
    const { container } = await render(chart())
    const surface = await waitFor(() => container.querySelector('.recharts-surface'))
    await actAsync(() => surface.dispatchEvent(new FocusEvent('focus')))
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    await actAsync(() => surface.dispatchEvent(event))
    expect(event.defaultPrevented).toBe(false)
  })

  it('has a data table with the same values', async () => {
    const { container } = await render(chart())
    expect([...container.querySelectorAll('tbody tr')].map((tr) => tr.textContent)).toEqual([
      'day 010 v',
      'day 140 v',
      'day 220 v',
      'day 330 v',
    ])
    expect(container.querySelector('figcaption')?.textContent).toContain('Visitors')
  })
})

describe('chart accessibility layer', () => {
  it('is never switched off in the dashboard source', () => {
    const dir = join(__dirname, '../src/dashboard')
    const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => /\.tsx?$/.test(f))
    expect(files.length).toBeGreaterThan(10)
    for (const file of files) {
      expect(readFileSync(join(dir, file), 'utf8'), file).not.toMatch(/accessibilityLayer\s*=\s*\{\s*false\s*\}/)
    }
  })
})
