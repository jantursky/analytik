import { afterEach, describe, expect, it, vi } from 'vitest'

import type { JourneysResult } from '../src/shared/types'
import { Dashboard } from '../src/dashboard/index'
import { FLOW_HEIGHT, FLOW_WIDTH, layoutFlow } from '../src/dashboard/views/journey-layout'
import { fakeApi } from './dashboard-fixtures'
import { waitFor } from './dashboard-helpers'
import { click, key, render, settled } from './react-render'

const result: JourneysResult = {
  from: 0,
  to: 1,
  capped: false,
  sessions: 100,
  multiPage: 60,
  nodes: [
    { id: '1:/', step: 1, kind: 'page', path: '/', sessions: 60 },
    { id: '1:/blog', step: 1, kind: 'page', path: '/blog', sessions: 40 },
    { id: '2:/pricing', step: 2, kind: 'page', path: '/pricing', sessions: 40 },
    { id: '2:exit', step: 2, kind: 'exit', path: null, sessions: 20 },
    { id: '2:*', step: 2, kind: 'other', path: null, sessions: 40 },
  ],
  links: [
    { from: '1:/', to: '2:/pricing', sessions: 40 },
    { from: '1:/', to: '2:exit', sessions: 20 },
    { from: '1:/blog', to: '2:*', sessions: 40 },
  ],
}

async function open(data: JourneysResult = result) {
  const api = fakeApi({ 'GET /sites/:id/journeys': () => data })
  const view = await render(<Dashboard api="/api" fetcher={api.fetcher} siteId="site_1" view="journeys" />)
  await settled()
  return { ...view, api }
}

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('layoutFlow', () => {
  const layout = layoutFlow(result)

  it('places one column per step inside the drawing', () => {
    expect(layout.steps).toEqual([1, 2])
    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0)
      expect(node.x).toBeLessThanOrEqual(FLOW_WIDTH)
      expect(node.y + node.height).toBeLessThanOrEqual(FLOW_HEIGHT + 1)
    }
  })

  it('draws a curve for every link, as wide as its sessions on the shared scale', () => {
    expect(layout.links).toHaveLength(3)
    const wide = layout.links.find((link) => link.sessions === 40 && link.to === '2:/pricing')
    const thin = layout.links.find((link) => link.sessions === 20)
    expect(wide?.width).toBeCloseTo((thin?.width ?? 0) * 2)
    expect(wide?.path).toMatch(/^M/)
  })

  it('handles an empty result', () => {
    expect(layoutFlow({ nodes: [], links: [] })).toEqual({ nodes: [], links: [], steps: [] })
  })
})

describe('Journeys view', () => {
  it('draws a labelled diagram and a table with the same links for screen readers', async () => {
    const { container } = await open()
    const svg = await waitFor(() => container.querySelector('svg.analytik-journeys'))
    expect(svg.getAttribute('aria-label')).toBe('Journeys')
    expect(svg.textContent).toContain('Step 1')
    expect(svg.textContent).toContain('Exit')
    const rows = [...container.querySelectorAll('table.analytik-sr-only tbody tr')].map((row) =>
      [...row.querySelectorAll('td')].map((cell) => cell.textContent),
    )
    expect(rows).toEqual([
      ['/', '/pricing', '40'],
      ['/', 'Exit', '20'],
      ['/blog', 'Other pages', '40'],
    ])
  })

  it('makes page bars reachable by keyboard and filters by entry page on step 1', async () => {
    const { container, api } = await open()
    const buttons = await waitFor(() => {
      const found = container.querySelectorAll('.analytik-journey-node[role="button"]')
      return found.length ? [...found] : null
    })
    // Exit and "other" bars are not buttons: only real pages can filter.
    expect(buttons).toHaveLength(3)
    expect(buttons.every((node) => node.getAttribute('tabindex') === '0')).toBe(true)
    expect(buttons[0]?.getAttribute('aria-label')).toBe('/, step 1: 60 sessions, filter by this')
    const before = api.find('GET', '/sites/site_1/journeys').length
    await key(buttons[0], 'Enter')
    await waitFor(() => (api.find('GET', '/sites/site_1/journeys').length > before ? true : null))
    const last = api.find('GET', '/sites/site_1/journeys').at(-1)
    expect(JSON.stringify(last?.params)).toContain('entry')
  })

  it('filters by page on later steps, also with Space and a click', async () => {
    const { container, api } = await open()
    const later = await waitFor(() => {
      const found = [...container.querySelectorAll('.analytik-journey-node[role="button"]')]
      return found.find((node) => node.getAttribute('aria-label')?.startsWith('/pricing'))
    })
    const before = api.find('GET', '/sites/site_1/journeys').length
    await key(later, ' ')
    await waitFor(() => (api.find('GET', '/sites/site_1/journeys').length > before ? true : null))
    const last = api.find('GET', '/sites/site_1/journeys').at(-1)
    expect(JSON.stringify(last?.params)).toContain('/pricing')
    await click(container.querySelector('.analytik-journey-node[role="button"]'))
  })

  it('says why a period has no path', async () => {
    const { container } = await open({ ...result, multiPage: 0, nodes: [], links: [] })
    await waitFor(() => (container.textContent.includes('no path to show') ? true : null))
    expect(container.querySelector('svg.analytik-journeys')).toBeNull()
  })

  it('notes when the range was cut to 30 days or the newest sessions were sampled', async () => {
    const { container } = await open({ ...result, capped: true, sessions: 5000 })
    await waitFor(() => container.querySelector('svg.analytik-journeys'))
    expect(container.textContent).toContain('Showing the last 30 days of the range.')
    expect(container.textContent).toContain('Based on the 5,000 newest sessions of the period.')
  })
})
