import { afterEach, describe, expect, it, vi } from 'vitest'

import { Dashboard } from '../src/dashboard/index'
import type { RetentionResult } from '../src/shared/types'
import { fakeApi } from './dashboard-fixtures'
import { waitFor } from './dashboard-helpers'
import { render, settled } from './react-render'

const WEEK = 7 * 86_400_000
const MARCH_2 = Date.UTC(2026, 2, 2)

const result: RetentionResult = {
  available: true,
  privacyMode: 'persistent',
  from: MARCH_2,
  to: MARCH_2 + 3 * WEEK,
  cohorts: [
    { week: MARCH_2, size: 100, active: [100, 30, 12] },
    { week: MARCH_2 + WEEK, size: 40, active: [40, 10] },
    { week: MARCH_2 + 2 * WEEK, size: 8, active: [8] },
  ],
}

async function open(data: RetentionResult = result) {
  const api = fakeApi({ 'GET /sites/:id/retention': () => data })
  const view = await render(<Dashboard api="/api" fetcher={api.fetcher} siteId="site_1" view="retention" />)
  await settled()
  return { ...view, api }
}

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('Retention view', () => {
  it('shows the share of each weekly cohort that came back, with the values in the cells', async () => {
    const { container } = await open()
    const table = await waitFor(() => container.querySelector('table.analytik-retention'))
    const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent)
    expect(headers).toEqual(['Cohort', 'Visitors', 'Week 0', 'Week 1', 'Week 2'])
    const rows = [...table.querySelectorAll('tbody tr')].map((row) =>
      [...row.querySelectorAll('td')].map((cell) => cell.textContent),
    )
    expect(rows).toEqual([
      ['100', '100%', '30%', '12%'],
      ['40', '100%', '25%', ''],
      ['8', '100%', '', ''],
    ])
    const cell = table.querySelector('tbody tr td:nth-child(4)')
    expect(cell?.getAttribute('title')).toBe('30 of 100 visitors')
    expect((cell as HTMLElement).style.getPropertyValue('--share')).toBe('0.3')
  })

  it('labels each row with the Monday of its week', async () => {
    const { container } = await open()
    const first = await waitFor(() => container.querySelector('table.analytik-retention tbody th'))
    expect(first.getAttribute('scope')).toBe('row')
    expect(first.textContent).toContain('2')
    expect(first.textContent).toMatch(/Mar/)
  })

  it('explains which privacy mode turns it on, and draws no heatmap', async () => {
    const { container } = await open({ ...result, available: false, privacyMode: 'strict', cohorts: [] })
    await waitFor(() => (container.textContent.includes('Persistent privacy mode') ? true : null))
    expect(container.querySelector('table')).toBeNull()
  })

  it('says so when the period has no new visitors', async () => {
    const { container } = await open({ ...result, cohorts: [] })
    await waitFor(() => (container.textContent.includes('No new visitors in this period.') ? true : null))
    expect(container.querySelector('table')).toBeNull()
  })
})
