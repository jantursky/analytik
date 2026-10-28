import { describe, expect, it, vi } from 'vitest'

import { AreaChart, BarList, MultiChart, Sparkline } from '../src/dashboard/charts'
import { DeltaBadge } from '../src/dashboard/ui'
import { waitFor } from './dashboard-helpers'
import { actAsync, click, key, render, settled } from './react-render'

const points = [10, 40, 20, 30].map((value, i) => ({ ts: i, value }))
const props = { label: 'Visitors', formatValue: (v: number) => `${v} v`, formatTime: (ts: number) => `day ${ts}` }

describe('AreaChart', () => {
  it('draws the area with Recharts, loaded on first use, plus a summary and a data table', async () => {
    const { container } = await render(<AreaChart points={points} {...props} />)
    expect(container.querySelector('figcaption')?.textContent).toBe('Visitors, 4 points, peak 40 v at day 1')
    expect([...container.querySelectorAll('tbody tr')].map((tr) => tr.textContent)).toEqual([
      'day 010 v',
      'day 140 v',
      'day 220 v',
      'day 330 v',
    ])
    await waitFor(() => container.querySelector('.recharts-area-curve'))
    expect(container.querySelector('.recharts-surface')?.getAttribute('aria-label')).toBe('Visitors chart')
    expect(container.querySelector('.analytik-legend')).toBeNull()
    expect(container.querySelectorAll('.recharts-yAxis')).toHaveLength(1)
    expect(container.querySelector('linearGradient stop')?.getAttribute('stop-color')).toBe(
      'var(--analytik-primary-series, var(--analytik-series-1))',
    )
  })

  it('draws the main series as bars or a bare line, in its own colour', async () => {
    const bars = await render(<AreaChart points={points} {...props} kind="bars" colour="red" />)
    await waitFor(() => bars.container.querySelector('.recharts-bar-rectangle'))
    expect(bars.container.querySelector('.recharts-area-curve')).toBeNull()
    expect(
      bars.container.querySelector<HTMLElement>('figure')?.style.getPropertyValue('--analytik-primary-series'),
    ).toBe('red')
    const line = await render(<AreaChart points={points} {...props} kind="line" />)
    await waitFor(() => line.container.querySelector('.recharts-area-curve'))
    expect(line.container.querySelector('.recharts-area-area')?.getAttribute('fill')).toBe('none')
  })

  it('shows a tooltip for the point under the keyboard focus', async () => {
    const { container } = await render(<AreaChart points={points} {...props} />)
    const surface = await waitFor(() => container.querySelector('.recharts-surface'))
    await actAsync(() => surface.dispatchEvent(new FocusEvent('focus')))
    await key(surface, 'ArrowRight')
    await key(surface, 'ArrowRight')
    const tip = await waitFor(() => container.querySelector('.analytik-chart-tip'))
    expect(tip.querySelector('.analytik-chart-tip-time')?.textContent).toMatch(/^day \d$/)
    expect(tip.querySelector('.analytik-chart-tip-row')?.textContent).toMatch(/^Visitors\d+ v$/)
  })

  it('draws a second series as bars on its own axis and toggles series from the legend', async () => {
    const secondary = { label: 'Revenue', values: [0, 5, 10, 0], formatValue: (v: number) => `$${v}` }
    const { container } = await render(<AreaChart points={points} {...props} secondary={secondary} />)
    await waitFor(() => container.querySelector('.recharts-bar-rectangle'))
    expect(container.querySelectorAll('.recharts-yAxis')).toHaveLength(2)
    expect([...container.querySelectorAll('tbody tr')].at(2)?.textContent).toBe('day 220 v$10')
    const legend = [...container.querySelectorAll('.analytik-legend-item')]
    expect(legend.map((b) => b.textContent)).toEqual(['Visitors', 'Revenue'])
    await click(legend[1])
    expect(legend[1]?.getAttribute('aria-pressed')).toBe('false')
    expect(container.querySelector('.recharts-bar-rectangle')).toBeNull()
    await click(legend[0])
    expect(container.querySelector('.recharts-area-curve')).toBeNull()
    await click(legend[1])
    await waitFor(() => container.querySelector('.recharts-bar-rectangle'))
  })

  it('handles no data', async () => {
    const none = await render(<AreaChart points={[]} {...props} />)
    expect(none.container.textContent).toBe('Nothing recorded in this period')
  })
})

describe('MultiChart comparison', () => {
  it('shows the earlier value in the tooltip, marked as the comparison', async () => {
    const series = [
      {
        key: 'visitors',
        label: 'Visitors',
        values: [10, 40, 20, 30],
        previous: [5, 20, undefined, 10],
        kind: 'area' as const,
        colour: 'red',
        scale: 'count',
        formatValue: (v: number) => `${v} v`,
      },
    ]
    const { container } = await render(
      <MultiChart times={[0, 1, 2, 3]} series={series} formatTime={(ts) => `day ${ts}`} height={200} />,
    )
    const surface = await waitFor(() => container.querySelector('.recharts-surface'))
    await actAsync(() => surface.dispatchEvent(new FocusEvent('focus')))
    await key(surface, 'ArrowRight')
    await key(surface, 'ArrowRight')
    const tip = await waitFor(() => container.querySelector('.analytik-chart-tip'))
    const rows = [...tip.querySelectorAll('.analytik-chart-tip-row')].map((r) => r.textContent)
    expect(rows).toHaveLength(2)
    expect(rows[1]).toMatch(/comparison/)
  })
})

describe('BarList', () => {
  it('renders proportional rows and selects them', async () => {
    const onSelect = vi.fn()
    const rows = [
      { key: '/', value: 100 },
      { key: '', value: 50 },
      { key: '/x', value: 1, label: <em>X</em> },
    ]
    const { container } = await render(
      <BarList rows={rows} label="Pages" formatValue={String} onSelect={onSelect} limit={2} />,
    )
    const buttons = container.querySelectorAll('button')
    expect(buttons).toHaveLength(2)
    expect(container.querySelector('ul')?.getAttribute('aria-label')).toBe('Pages')
    await settled()
    expect([...container.querySelectorAll<HTMLElement>('.analytik-bar-fill')].map((f) => f.style.transform)).toEqual([
      'none',
      'scaleX(0.5)',
    ])
    expect(buttons[1]?.textContent).toBe('(none)50, filter by this')
    await click(buttons[0])
    expect(onSelect).toHaveBeenCalledWith('/')
  })

  it('renders static rows and an empty state', async () => {
    const { container } = await render(<BarList rows={[{ key: 'a', value: 0 }]} label="L" formatValue={String} />)
    expect(container.querySelector('button')).toBeNull()
    expect(container.querySelector('.analytik-bar')?.textContent).toBe('a0')
    const empty = await render(<BarList rows={[]} label="L" formatValue={String} />)
    expect(empty.container.textContent).toBe('Nothing recorded in this period')
  })
})

describe('Sparkline and DeltaBadge', () => {
  it('draws a decorative trend area', async () => {
    const { container } = await render(<Sparkline values={[0, 5, 10]} />)
    expect(container.querySelector('.analytik-sparkline')?.getAttribute('aria-hidden')).toBe('true')
    await waitFor(() => container.querySelector('.analytik-sparkline .recharts-area-curve'))
    const none = await render(<Sparkline values={[1]} />)
    expect(none.container.innerHTML).toBe('')
  })

  it('marks trends, inverted where lower is better', async () => {
    const { container } = await render(
      <>
        <DeltaBadge change={0.1} />
        <DeltaBadge change={0.1} invert />
        <DeltaBadge change={-0.1} />
        <DeltaBadge change={0} />
        <DeltaBadge change={null} />
      </>,
    )
    expect([...container.querySelectorAll('.analytik-delta')].map((b) => b.getAttribute('data-trend'))).toEqual([
      'up',
      'down',
      'down',
      'flat',
      'flat',
    ])
    expect(container.querySelector('.analytik-delta')?.textContent).toBe('Change from previous period: +10%')
    expect(container.querySelectorAll('.analytik-delta svg')).toHaveLength(3)
  })
})
