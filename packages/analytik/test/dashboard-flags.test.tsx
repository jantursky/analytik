import { describe, expect, it, vi } from 'vitest'

import { Flag } from '../src/dashboard/flags'
import { waitFor } from './dashboard-helpers'
import { render } from './react-render'

describe('country flags', () => {
  it('draws a known country as an SVG, loading the flag chunk once for every row', async () => {
    const { container } = await render(
      <>
        <Flag code="SK" />
        <Flag code="sk" />
        <Flag code="DE" />
      </>,
    )
    await waitFor(() => container.querySelectorAll('svg.analytik-flag').length === 3)
    const flags = container.querySelectorAll('svg.analytik-flag')
    expect(flags).toHaveLength(3)
    expect(flags[0]?.innerHTML).toContain('analytik-flag-SK')
    expect(flags[2]?.innerHTML).toContain('analytik-flag-DE')
    expect(container.querySelector('[data-fallback]')).toBeNull()
  })

  it('shows an unknown code in a neutral circle', async () => {
    const { container } = await render(<Flag code="QQ" />)
    await waitFor(() => container.querySelector('.analytik-flag')?.textContent === 'QQ')
    expect(container.querySelector('.analytik-flag')?.getAttribute('data-fallback')).toBe('')
  })
})

describe('country flags when the chunk fails', () => {
  it('keeps the row working with an empty circle', async () => {
    vi.resetModules()
    vi.doMock('../src/dashboard/flags-data', () => {
      throw new Error('offline')
    })
    const { Flag: Fresh } = await import('../src/dashboard/flags')
    const { container } = await render(<Fresh code="SK" />)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(container.querySelector('.analytik-flag')?.getAttribute('data-fallback')).toBe('')
    vi.doUnmock('../src/dashboard/flags-data')
  })
})
