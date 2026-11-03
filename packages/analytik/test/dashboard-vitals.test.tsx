import { afterEach, describe, expect, it, vi } from 'vitest'

import { Dashboard, type DashboardView } from '../src/dashboard/index'
import type { VitalsResult } from '../src/shared/types'
import { fakeApi } from './dashboard-fixtures'
import { waitFor } from './dashboard-helpers'
import { byLabel, byText, click, fill, render, settled, submit } from './react-render'

const measured: VitalsResult = {
  enabled: true,
  total: { samples: 120, lcp: 2400, inp: 350, cls: 0.3 },
  pages: [
    { path: '/pricing', samples: 80, lcp: 3100, inp: 180, cls: 0.05 },
    { path: '/blog', samples: 40, lcp: 1200, inp: null, cls: null },
  ],
}

function withVitals(vitals: VitalsResult = measured) {
  const api = fakeApi()
  api.state.vitals = vitals
  return api
}

async function open(api = fakeApi(), view?: DashboardView, extra: { share?: string } = {}) {
  const result = await render(<Dashboard api="/api" fetcher={api.fetcher} siteId="site_1" view={view} {...extra} />)
  await settled()
  return { ...result, api }
}

const table = (container: Element) => container.querySelector('.analytik-vitals')
const rows = (container: Element) =>
  [...(table(container)?.querySelectorAll('tbody tr') ?? [])].map((tr) =>
    [...tr.children].map((cell) => cell.textContent.trim()),
  )

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('Core Web Vitals in the Pages view', () => {
  it('shows the 75th percentile per page with each rating written out', async () => {
    const { container, api } = await open(withVitals(), 'pages')
    await waitFor(() => table(container))
    const head = [...(table(container)?.querySelectorAll('thead th') ?? [])].map((th) => th.textContent.trim())
    expect(head).toEqual(['Page', 'Reports', 'LCP', 'INP', 'CLS'])
    expect(table(container)?.querySelector('abbr')?.getAttribute('title')).toBe('Largest Contentful Paint')
    expect(rows(container)).toEqual([
      ['All pages', '120', '2.4 sGood', '350 msNeeds work', '0.3Poor'],
      ['/pricing', '80', '3.1 sNeeds work', '180 msGood', '0.05Good'],
      ['/blog', '40', '1.2 sGood', '—', '—'],
    ])
    // The cell's rating also drives its colour.
    expect(table(container)?.querySelector('tbody tr:nth-child(2) td:nth-child(3)')?.getAttribute('data-rating')).toBe(
      'needs-work',
    )
    // It asks for the dashboard's range and filters, like the other views.
    expect(api.find('GET', '/sites/site_1/vitals')[0]?.params).toMatchObject({ from: expect.any(String) as string })
  })

  it('tells a site that does not measure how to turn it on, and a site that does that nothing came in yet', async () => {
    const off = await open(fakeApi(), 'pages')
    await waitFor(() => off.container.textContent.includes('Turn on Core Web Vitals'))
    expect(off.container.textContent).toContain('Settings → Tracking code')
    expect(table(off.container)).toBeNull()
    await off.unmount()

    const on = await open(
      withVitals({ ...measured, total: { samples: 0, lcp: null, inp: null, cls: null }, pages: [] }),
      'pages',
    )
    await waitFor(() => on.container.textContent.includes('No measurements in this period'))
    expect(on.container.textContent).not.toContain('Turn on Core Web Vitals')
  })

  it('shows the error when the numbers cannot be read, and keeps the rest of the view', async () => {
    const api = fakeApi({ 'GET /sites/:id/vitals': () => Response.json({ error: 'boom' }, { status: 500 }) })
    const { container } = await open(api, 'pages')
    await waitFor(() => container.querySelector('.analytik-error, [role="alert"]'))
    expect(container.querySelector('.analytik-bars')).not.toBeNull()
  })

  it('is left out of a shared dashboard, which cannot read it', async () => {
    const api = withVitals()
    const { container } = await open(api, 'pages', { share: 'good-token-1234567890abcdef' })
    await settled()
    expect(table(container)).toBeNull()
    expect(api.find('GET', '/sites/site_1/vitals')).toHaveLength(0)
  })
})

async function trackingSection(container: Element): Promise<void> {
  await click(byText(container, 'Tracking code', '.analytik-settings-nav button'))
  await settled()
}

describe('Core Web Vitals in the settings', () => {
  it('turns the measuring on with a share of page views, and puts it into the snippet', async () => {
    const { container, api } = await open(fakeApi(), 'settings')
    await trackingSection(container)
    expect(container.querySelector('code')?.textContent).not.toContain('data-vitals')
    await click(container.querySelector('[role="switch"]'))
    expect(byLabel(container, 'Share of page views measured (%)')?.value).toBe('10')
    await submit(container.querySelector('form'))
    await settled()
    expect(api.find('PATCH', '/sites/site_1')[0]?.body).toEqual({ vitalsSample: 10 })
    expect(container.querySelector('code')?.textContent).toContain('data-vitals="10"')
  })

  it('keeps the share between 1 and 100, falling back to the default for nonsense', async () => {
    const { container, api } = await open(fakeApi(), 'settings')
    await trackingSection(container)
    await click(container.querySelector('[role="switch"]'))
    const input = byLabel(container, 'Share of page views measured (%)')
    for (const [typed, saved] of [
      ['250', 100],
      ['0.2', 10],
      ['', 10],
      ['25', 25],
    ] as const) {
      await fill(input, typed)
      await submit(container.querySelector('form'))
      await settled()
      expect((api.find('PATCH', '/sites/site_1').at(-1)?.body as { vitalsSample: number }).vitalsSample).toBe(saved)
    }
  })

  it('turns it off again with 0, and shows the saved share when it is on already', async () => {
    const api = fakeApi()
    api.state.sites = api.state.sites.map((s) => (s.id === 'site_1' ? { ...s, vitalsSample: 40 } : s))
    const { container } = await open(api, 'settings')
    await trackingSection(container)
    expect(byLabel(container, 'Share of page views measured (%)')?.value).toBe('40')
    expect(container.querySelector('code')?.textContent).toContain('data-vitals="40"')
    await click(container.querySelector('[role="switch"]'))
    expect(byLabel(container, 'Share of page views measured (%)')).toBeUndefined()
    await submit(container.querySelector('form'))
    await settled()
    expect(api.find('PATCH', '/sites/site_1')[0]?.body).toEqual({ vitalsSample: 0 })
    expect(container.querySelector('code')?.textContent).not.toContain('data-vitals')
  })
})
