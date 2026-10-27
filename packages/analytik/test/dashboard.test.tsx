import { afterEach, describe, expect, it, vi } from 'vitest'

import { createApiClient } from '../src/dashboard/api'
import {
  Dashboard,
  type DashboardView,
  DashboardProvider,
  Overview,
  presetRange,
  SnippetGenerator,
  useDashboard,
} from '../src/dashboard/index'
import { describeTimeZone, zoneLabel } from '../src/dashboard/ui/timezone'
import { BLOCK_IDS } from '../src/dashboard/views/blocks'
import { fakeApi, otherSite, realtime, row, site } from './dashboard-fixtures'
import { choose, comboboxInput, press, selectTrigger, switchFor, type, waitFor } from './dashboard-helpers'
import { actAsync, byLabel, byText, click, fill, key, render, settled, submit } from './react-render'

async function open(
  api = fakeApi(),
  view?: DashboardView,
  extra: { siteId?: string; theme?: 'dark'; urlState?: boolean } = {},
) {
  const result = await render(<Dashboard api="/api" fetcher={api.fetcher} view={view} {...extra} />)
  await settled()
  return { ...result, api }
}

const timeZoneText = (zone: string) => `${zoneLabel(zone)} (${describeTimeZone(zone).offset})`
const nav = (container: HTMLElement, label: string) => byText(container, label, '.analytik-nav-item')
const texts = (container: Element, selector: string) =>
  [...container.querySelectorAll(selector)].map((el) => el.textContent.trim())

afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
})

describe('Dashboard shell', () => {
  it('lets the theme be switched and the password shown on the login screen', async () => {
    const api = fakeApi()
    api.state.loggedIn = false
    const { container } = await open(api)
    const root = () => container.querySelector('.analytik')
    expect(container.querySelector('.analytik-main')?.hasAttribute('data-centered')).toBe(true)
    const toggle = () => container.querySelector<HTMLButtonElement>('.analytik-login-head button')
    expect(toggle()?.getAttribute('aria-label')).toBe('Theme: Same as the page. Switch to light')
    await click(toggle())
    expect(root()?.getAttribute('data-theme')).toBe('light')
    await click(toggle())
    expect(root()?.getAttribute('data-theme')).toBe('dark')
    await click(toggle())
    expect(root()?.getAttribute('data-theme')).toBeNull()
    const input = byLabel(container, 'Admin password')!
    expect(input.getAttribute('type')).toBe('password')
    await click(container.querySelector('.analytik-password-toggle'))
    expect(input.getAttribute('type')).toBe('text')
    await click(container.querySelector('.analytik-password-toggle'))
    expect(input.getAttribute('type')).toBe('password')
  })

  it('shows the login form on 401 and loads the sites after signing in', async () => {
    const api = fakeApi()
    api.state.loggedIn = false
    const { container } = await open(api)
    const form = container.querySelector('form')
    expect(container.querySelector('h1')?.textContent).toBe('Sign in to Analytik')
    await fill(byLabel(container, 'Admin password'), 'nope')
    await submit(form)
    await settled()
    expect(container.querySelector('[role="alert"] .analytik-error-text')?.textContent).toBe('Wrong password.')
    await fill(byLabel(container, 'Admin password'), 'secret')
    await submit(form)
    await settled()
    expect(container.querySelector('.analytik-toolbar h1')?.textContent).toBe('Overview')
    expect(selectTrigger(container, 'Site')?.textContent).toBe('EExample')
  })

  it('keeps the site and view in the address when asked to', async () => {
    history.replaceState(null, '', '/?section=pages&site=site_2')
    try {
      const { container } = await open(fakeApi(), undefined, { urlState: true })
      expect(container.querySelector('.analytik-toolbar h1')?.textContent).toBe('Pages')
      expect(location.search).toBe('?section=pages&site=site_2')
      await click(nav(container, 'Events'))
      expect(location.search).toBe('?section=events&site=site_2')
      await click(nav(container, 'Overview'))
      expect(location.search).toBe('?site=site_2')
      history.back()
      await waitFor(() => container.querySelector('.analytik-toolbar h1')?.textContent === 'Events')
      history.replaceState(null, '', '/?section=nope')
    } finally {
      history.replaceState(null, '', '/')
    }
  })

  it('leaves the address alone unless asked', async () => {
    const { container } = await open()
    await click(nav(container, 'Pages'))
    expect(location.search).toBe('')
  })

  it('signs out', async () => {
    const { container, api } = await open()
    await click(byText(container, 'Log out', 'button'))
    await settled()
    expect(api.find('POST', '/auth/logout')).toHaveLength(1)
    expect(container.querySelector('h1')?.textContent).toBe('Sign in to Analytik')
  })

  it('customizes the overview layout and remembers it', async () => {
    const { container, unmount } = await open()
    const blocks = () => [...container.querySelectorAll('.analytik-block:not(.analytik-add-block)')]
    const names = () => blocks().map((b) => b.querySelector('.analytik-block-name')?.textContent)
    const category = (name: string) =>
      [...document.body.querySelectorAll<HTMLElement>('.analytik-picker-category')].find((b) =>
        b.textContent.startsWith(name),
      )
    const tile = (name: string) =>
      [...document.body.querySelectorAll<HTMLElement>('.analytik-picker-tile')].find(
        (t) => t.querySelector('.analytik-picker-head strong')?.textContent === name,
      )
    expect(blocks()).toHaveLength(6)
    expect(blocks()[0]?.hasAttribute('data-wide')).toBe(true)
    expect(container.querySelector('.analytik-add-block')).toBeNull()
    await click(byText(container, 'Customize', 'button'))
    expect(container.querySelector('.analytik-board')?.hasAttribute('data-editing')).toBe(true)
    expect(container.querySelector('[aria-label="Move Summary and chart earlier"]')?.hasAttribute('disabled')).toBe(
      true,
    )
    await click(container.querySelector('[aria-label="Move Summary and chart later"]'))
    await click(byText(blocks()[0]!, 'Half width', 'button'))
    await click(container.querySelector('[aria-label="Remove Geography"]'))
    expect(names()).toEqual(['Acquisition', 'Summary and chart', 'Pages', 'Devices', 'Goals'])
    expect(blocks()[0]?.hasAttribute('data-wide')).toBe(true)

    await click(container.querySelector('[aria-label="Add a block after Pages"]'))
    expect(byText(document.body, 'Pick one or more blocks to add after Pages.', 'p')).toBeDefined()
    expect(category('All blocks')?.textContent).toBe('All blocks16')
    await click(category('Revenue'))
    expect([...document.body.querySelectorAll('.analytik-picker-head strong')].map((t) => t.textContent)).toEqual([
      'Channel performance',
      'Revenue by source',
      'Revenue by country',
      'Average order value',
      'Recent payments',
    ])
    await click(tile('Average order value'))
    expect(tile('Average order value')?.getAttribute('aria-checked')).toBe('true')
    await click(tile('Recent payments'))
    expect(byText(document.body, '2 blocks', 'strong')).toBeDefined()
    await click(tile('Recent payments'))
    await click(byText(document.body, 'Add block', 'button'))
    expect(names()).toEqual(['Acquisition', 'Summary and chart', 'Pages', 'Average order value', 'Devices', 'Goals'])
    expect(byText(container, 'Average order value', '.analytik-card h2')).toBeDefined()

    await click(container.querySelector('.analytik-add-tile'))
    await click(category('All blocks'))
    expect(tile('Pages')?.getAttribute('aria-disabled')).toBe('true')
    expect(tile('Pages')?.textContent).toContain('On the overview')
    await click(tile('Pages'))
    expect(byText(document.body, 'Add block', 'button')?.hasAttribute('disabled')).toBe(true)
    await click(byText(document.body, 'Cancel', 'button'))

    await click(byText(container, 'Done', 'button'))
    expect(container.querySelector('.analytik-board')?.hasAttribute('data-editing')).toBe(false)
    expect(blocks()).toHaveLength(6)
    expect(blocks()[0]?.querySelector('.analytik-overview')).toBeNull()
    expect(blocks()[1]?.querySelector('.analytik-overview')).not.toBeNull()
    await unmount()

    const again = await open()
    const stored = [...again.container.querySelectorAll('.analytik-block')]
    expect(stored).toHaveLength(6)
    expect(stored[3]?.textContent).toContain('Average order value')
    await click(byText(again.container, 'Customize', 'button'))
    await click(byText(again.container, 'Reset', 'button'))
    expect(byText(document.body, 'Reset the overview?', 'h2')).toBeDefined()
    await click(byText(document.body, 'Reset layout', 'button'))
    await click(byText(again.container, 'Done', 'button'))
    expect(again.container.querySelectorAll('.analytik-block')).toHaveLength(6)
    expect(again.container.querySelector('.analytik-block')?.querySelector('.analytik-overview')).not.toBeNull()
  })

  it('renders every block of the catalogue', async () => {
    localStorage.setItem('analytik:preferences', JSON.stringify({ layout: BLOCK_IDS.map((id) => ({ id })) }))
    const { container, api } = await open()
    expect(container.querySelectorAll('.analytik-board > .analytik-block')).toHaveLength(BLOCK_IDS.length)
    expect(texts(container, '.analytik-kpi .analytik-stat-label')).toEqual([
      'Visitors',
      'Pageviews',
      'Sessions',
      'Revenue',
    ])
    const card = (title: string) =>
      [...container.querySelectorAll('.analytik-card')].find((c) =>
        c.querySelector('h2')?.textContent.startsWith(title),
      )
    expect(texts(card('Channel performance')!, 'tbody td:first-child')).toEqual(['Organic Search', 'Direct'])
    expect(texts(card('Channel performance')!, 'tbody td:last-child')).toEqual(['€99.00', '—'])
    expect(texts(card('Device split')!, '.analytik-legend-list li')).toEqual(['device-a100%'])
    expect(card('Device split')?.querySelectorAll('circle')).toHaveLength(2)
    expect(texts(card('Funnel')!, '.analytik-funnel-bars li')).toEqual(['/1,000', 'signup250'])
    expect(card('Average order value')?.querySelector('.analytik-big-number strong')?.textContent).not.toBe('—')
    expect(card('Recent payments')?.querySelectorAll('.analytik-feed-list li')).toHaveLength(2)
    expect(card('Recent payments')?.querySelector('[data-refund]')).not.toBeNull()
    expect(card('Live now')?.querySelector('.analytik-live-count')?.textContent).toContain('right now')
    expect(card('Revenue by source')).toBeDefined()
    expect(card('Revenue by country')).toBeDefined()

    await click(byText(card('Channel performance')!, 'Direct', 'button'))
    await settled()
    expect(api.find('GET', '/sites/site_1/overview').at(-1)?.params.channel).toBe('Direct')
    await click(byText(card('Recent payments')!, 'View all', 'button'))
    expect(container.querySelector('.analytik-toolbar h1')?.textContent).toBe('Revenue')
  })

  it('shows empty catalogue blocks', async () => {
    localStorage.setItem(
      'analytik:preferences',
      JSON.stringify({ layout: ['channels', 'devices', 'funnel', 'payments'].map((id) => ({ id })) }),
    )
    const api = fakeApi({
      'GET /sites/:id/breakdown': () => [],
      'GET /sites/:id/payments': () => ({ items: [], nextCursor: null, total: 0 }),
    })
    api.state.funnels = []
    const { container } = await open(api)
    expect(texts(container, '.analytik-empty')).toEqual([
      'Nothing recorded in this period',
      'Nothing recorded in this period',
      'No funnels yetCreate a funnel',
      'No payments in this period',
    ])
    await click(byText(container, 'Create a funnel', 'button'))
    expect(container.querySelector('.analytik-toolbar h1')?.textContent).toBe('Funnels')
  })

  it('shows every block in the picker with sample numbers', async () => {
    const { container } = await open()
    await click(byText(container, 'Customize', 'button'))
    await click(container.querySelector('.analytik-add-tile'))
    expect(document.body.querySelectorAll('.analytik-picker-tile')).toHaveLength(BLOCK_IDS.length)
    expect(document.body.querySelectorAll('.analytik-picker-tile .analytik-preview')).toHaveLength(BLOCK_IDS.length)
    expect(document.body.querySelector('.analytik-picker-tile .analytik-preview-bars li')?.textContent).toBe(
      'Organic Search4,812',
    )
    const tile = [...document.body.querySelectorAll<HTMLElement>('.analytik-picker-tile')].find(
      (t) => t.querySelector('.analytik-picker-head strong')?.textContent === 'Funnel',
    )
    await click(tile)
    await click(
      [...document.body.querySelectorAll<HTMLElement>('.analytik-picker-tile')].find(
        (t) => t.querySelector('.analytik-picker-head strong')?.textContent === 'Live now',
      ),
    )
    await click(byText(document.body, 'Add 2 blocks', 'button'))
    expect(container.querySelectorAll('.analytik-block:not(.analytik-add-block)')).toHaveLength(8)
  })

  it('renders overview stats with deltas, a dual-axis chart and breakdowns', async () => {
    const { container, api } = await open(fakeApi(), undefined, { theme: 'dark' })
    expect(container.querySelector('.analytik')?.getAttribute('data-theme')).toBe('dark')
    expect(texts(container, '.analytik-stat-label')).toEqual([
      'Visitors',
      'Revenue',
      'Conversion rate',
      'Revenue per visitor',
      'Bounce rate',
      'Visit duration',
      'Live now',
    ])
    expect(texts(container, '.analytik-stat-value')).toEqual([
      '1,200',
      '€1,299.00',
      '1.1%',
      '€1.08',
      '42%',
      '1m 23s',
      '4',
    ])
    expect(
      texts(container, '.analytik-stat .analytik-delta').map((t) => t.replace('Change from previous period: ', '')),
    ).toEqual(['+20%', 'new', '+8%', '+20%', '+5%', '-8%'])
    expect(container.querySelector('.analytik-stat:nth-child(5) .analytik-delta')?.getAttribute('data-trend')).toBe(
      'down',
    )
    expect(container.querySelectorAll('.analytik-stat .analytik-marker')).toHaveLength(2)
    expect(container.querySelector('figcaption')?.textContent).toMatch(
      /^Visitors, Revenue, 4 points\. Visitors peaks at 600 on /,
    )
    expect(texts(container, '.analytik-chart table tbody tr')[3]).toMatch(/600€99\.00$/)
    await waitFor(() => container.querySelector('.recharts-surface'))
    expect(texts(container, '.analytik-legend-item')).toEqual(['Visitors', 'Revenue'])
    const overview = api.find('GET', '/sites/site_1/overview')[0]
    expect(overview?.params).toMatchObject({ interval: 'day', tz: 'UTC' })
    expect(Date.parse(overview?.params.to ?? '') - Date.parse(overview?.params.from ?? '')).toBeGreaterThan(
      6 * 86400000,
    )
    expect(api.find('GET', '/sites/site_1/breakdown').map((r) => r.params.dimension)).toEqual([
      'channel',
      'country',
      'page',
      'browser',
      'goal',
    ])
    expect(texts(container, '.analytik-col-head')).toEqual(['Visitors', 'Visitors', 'Visitors', 'Visitors', 'Visitors'])

    await click(byText(container, 'Open live map', 'button'))
    await settled()
    expect(nav(container, 'Live')?.getAttribute('aria-current')).toBe('page')
  })

  it('marks browsers, systems and devices with an icon', async () => {
    const { container } = await open(
      fakeApi({
        'GET /sites/:id/breakdown': ({ params }) =>
          params.dimension === 'browser'
            ? [row('Chrome', 5), row('Mobile Safari', 3), row('Netscape', 1)]
            : params.dimension === 'device'
              ? [row('Mobile', 4), row('Robot', 1)]
              : [],
      }),
    )
    const card = byText(container, 'Browser', '[role="tab"]')?.closest('section')
    const icons = () =>
      [...(card?.querySelectorAll('.analytik-bar-label') ?? [])].map((l) => !!l.querySelector('.analytik-logo, svg'))
    expect(icons()).toEqual([true, true, false])
    expect(card?.querySelectorAll('.analytik-bar-icon')).toHaveLength(3)
    await waitFor(() => card?.querySelector('img.analytik-logo'))
    expect(
      [...(card?.querySelectorAll<HTMLImageElement>('img.analytik-logo') ?? [])].map((i) =>
        decodeURIComponent(i.src).startsWith('data:image/svg+xml,<svg'),
      ),
    ).toEqual([true, true])
    await click(byText(card!, 'Device', '[role="tab"]'))
    await settled()
    await waitFor(() => card?.querySelector('.analytik-bar-label'))
    expect(texts(card!, '.analytik-bar-label')).toEqual(['Mobile', 'Robot'])
    expect(icons()).toEqual([true, false])
  })

  it("keeps the previous tab's rows until the next tab's rows arrive", async () => {
    let release = (): void => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { container } = await open(
      fakeApi({
        'GET /sites/:id/breakdown': async ({ params }) => {
          if (params.dimension === 'os') await gate
          return params.dimension === 'os'
            ? [row('Windows', 2)]
            : params.dimension === 'browser'
              ? [row('Chrome', 5)]
              : []
        },
      }),
    )
    const card = byText(container, 'Browser', '[role="tab"]')?.closest('section')
    expect(texts(card!, '.analytik-bar-label')).toEqual(['Chrome'])
    await click(byText(card!, 'OS', '[role="tab"]'))
    await settled()
    expect(texts(card!, '.analytik-bar-label')).toEqual(['Chrome'])
    expect(card?.querySelector('[aria-label="Browser by visitors"]')).not.toBeNull()
    release()
    await waitFor(() => card?.querySelector('[aria-label="OS by visitors"]'))
    expect(texts(card!, '.analytik-bar-label')).toEqual(['Windows'])
  })

  it('labels countries with their flag and name and expands long lists', async () => {
    const many = Array.from({ length: 12 }, (_, i) => row(`/p${i}`, 100 - i))
    const { container, api } = await open(
      fakeApi({
        'GET /sites/:id/breakdown': ({ params }) =>
          params.dimension === 'country' ? [row('DE', 5), row('', 1)] : params.dimension === 'page' ? many : [],
      }),
    )
    expect(texts(container, '.analytik-bar-label')).toContain('🇩🇪Germany')
    expect(texts(container, '.analytik-bar-label')).toContain('(none)')
    const pages = byText(container, 'Pages', 'h2')?.closest('section')
    expect(pages?.querySelectorAll('.analytik-bar')).toHaveLength(8)
    const details = byText(pages!, 'Details', 'button')
    await click(details)
    expect(pages?.querySelectorAll('.analytik-bar')).toHaveLength(12)
    expect(details?.getAttribute('aria-expanded')).toBe('true')
    await click(byText(pages!, 'Fewer', 'button'))
    expect(pages?.querySelectorAll('.analytik-bar')).toHaveLength(8)
    await click(byText(container, '/p0', '.analytik-bar-label')?.closest('button'))
    await settled()
    expect(api.find('GET', '/sites/site_1/overview').at(-1)?.params.page).toBe('/p0')
  })

  it('filters by clicking a row, shows removable chips and refetches', async () => {
    const { container, api } = await open()
    await click(byText(container, 'Organic Search', '.analytik-bar-label')?.closest('button'))
    await settled()
    expect(api.find('GET', '/sites/site_1/overview').at(-1)?.params.channel).toBe('Organic Search')
    await click(byText(container, '/pricing', '.analytik-bar-label')?.closest('button'))
    await settled()
    expect(texts(container, '.analytik-chip')).toEqual(['channel Organic Search ×', 'page /pricing ×'])
    await click(container.querySelector('[aria-label="Remove filter channel is Organic Search"]'))
    await settled()
    expect(api.find('GET', '/sites/site_1/overview').at(-1)?.params).toMatchObject({ page: '/pricing' })
    expect(api.find('GET', '/sites/site_1/overview').at(-1)?.params.channel).toBeUndefined()
    await click(byText(container, 'Direct', '.analytik-bar-label')?.closest('button'))
    await click(byText(container, 'Clear all', 'button'))
    expect(container.querySelector('.analytik-chip')).toBeNull()
  })

  it('switches tabs with the keyboard', async () => {
    const { container, api } = await open()
    const tab = container.querySelector('[role="tab"][aria-selected="true"]')
    expect(tab?.textContent).toBe('Channel')
    await key(tab, 'ArrowRight')
    await settled()
    expect(document.activeElement?.textContent).toBe('Referrer')
    expect(api.find('GET', '/sites/site_1/breakdown').at(-1)?.params.dimension).toBe('referrer')
    await key(document.activeElement, 'ArrowLeft')
    await key(document.activeElement, 'End')
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Term')
    await key(document.activeElement, 'ArrowRight')
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Channel')
    await key(document.activeElement, 'x')
  })

  it('changes the date range with presets and a range picked on the calendar', async () => {
    const { container, api } = await open()
    const trigger = () => container.querySelector('.analytik-range-trigger')
    await click(trigger())
    await settled()
    expect(byText(container, 'Past 7 days', '.analytik-preset')?.getAttribute('aria-pressed')).toBe('true')
    await click(byText(container, 'Past 12 months', '.analytik-preset'))
    await settled()
    expect(api.find('GET', '/sites/site_1/overview').at(-1)?.params.interval).toBe('month')
    expect(trigger()?.textContent).toBe('Past 12 months')

    await click(trigger())
    await settled()
    const title = () => container.querySelector('.analytik-calendar-title')?.textContent
    for (let i = 0; i < 48 && title() !== 'January 2026'; i++) {
      await click(container.querySelector('[aria-label="Previous month"]'))
    }
    expect(title()).toBe('January 2026')
    const day = (iso: string) => container.querySelector(`[data-day="${iso}"]`)
    await click(day('2026-01-03'))
    const summary = () => container.querySelector('.analytik-range-foot span')?.textContent
    expect(summary()).toBe('Jan 3, 2026')
    await actAsync(() => day('2026-01-05')?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    await click(day('2026-01-01'))
    expect(day('2026-01-02')?.hasAttribute('data-between')).toBe(true)
    expect(summary()).toMatch(/^Jan 1\s–\s3, 2026$/)
    await click(byText(container, 'Apply', 'button'))
    await settled()
    const last = api.find('GET', '/sites/site_1/overview').at(-1)?.params
    expect(last?.from).toBe(new Date(2026, 0, 1).toISOString())
    expect(last?.to).toBe(new Date(2026, 0, 4).toISOString())
    expect(last?.interval).toBe('day')
    expect(trigger()?.textContent).toMatch(/^Jan 1\s–\s3, 2026$/)
  })

  it('moves through the calendar with the keyboard', async () => {
    const { container } = await open()
    await click(container.querySelector('.analytik-range-trigger'))
    await settled()
    const focused = () => document.activeElement?.getAttribute('data-day') ?? ''
    const start = [...container.querySelectorAll<HTMLElement>('.analytik-day:not([data-outside])')][14]!
    await actAsync(() => start.focus())
    const first = focused()
    await key(start, 'ArrowLeft')
    await key(document.activeElement, 'ArrowUp')
    await key(document.activeElement, 'ArrowDown')
    await key(document.activeElement, 'ArrowRight')
    expect(focused()).toBe(first)
    await key(document.activeElement, 'Home')
    expect(new Date(`${focused()}T00:00`).getDay()).toBe(1)
    await key(document.activeElement, 'End')
    expect(new Date(`${focused()}T00:00`).getDay()).toBe(0)
    const month = container.querySelector('.analytik-calendar-title')?.textContent
    await key(document.activeElement, 'PageUp')
    await settled()
    expect(container.querySelector('.analytik-calendar-title')?.textContent).not.toBe(month)
    expect(focused().slice(8)).toBe('01')
    await key(document.activeElement, 'PageDown')
    await key(document.activeElement, 'x')
    await click(byText(container, 'Next month', 'button') ?? container.querySelector('[aria-label="Next month"]'))
    await actAsync(() =>
      container.querySelector('.analytik-calendar table')?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })),
    )
  })

  it('steps through periods, picks an interval and refreshes', async () => {
    const { container, api } = await open()
    const last = () => api.find('GET', '/sites/site_1/overview').at(-1)?.params
    const first = last()
    expect(byLabel(container, 'Next period')).toBeDefined()
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Next period"]')?.disabled).toBe(true)
    await click(container.querySelector('[aria-label="Previous period"]'))
    await settled()
    expect(last()?.to).toBe(first?.from)
    expect(container.querySelector('.analytik-range-trigger')?.textContent).toMatch(/–/)
    await click(container.querySelector('[aria-label="Next period"]'))
    await settled()
    expect(last()?.from).toBe(first?.from)
    await click(container.querySelector('[aria-label="Next period"]'))

    await click(selectTrigger(container, 'Interval'))
    await settled()
    expect(texts(document.body, '[role="option"]')).toEqual(['By hour', 'By day'])
    await click(selectTrigger(container, 'Interval'))
    await choose(selectTrigger(container, 'Interval'), 'By hour')
    expect(last()?.interval).toBe('hour')

    const before = api.find('GET', '/sites/site_1/overview').length
    await click(container.querySelector('[aria-label="Refresh"]'))
    await settled()
    expect(api.find('GET', '/sites/site_1/overview').length).toBe(before + 1)

    await click(container.querySelector('.analytik-range-trigger'))
    await settled()
    await click(byText(container, 'Past 30 days', '.analytik-preset'))
    await settled()
    const count = api.find('GET', '/sites/site_1/overview').length
    await click(container.querySelector('[aria-label="Refresh"]'))
    await settled()
    expect(api.find('GET', '/sites/site_1/overview').length).toBe(count + 1)
    expect(last()?.interval).toBe('day')
  })

  it('loads the settings from the database and saves changes back', async () => {
    const api = fakeApi()
    api.state.preferences = { live: true, layout: [{ id: 'kpis', wide: true }, { id: 'goals' }] }
    const { container } = await open(api)
    await settled()
    const live = switchFor(container, 'Live')
    expect(live?.getAttribute('aria-checked')).toBe('true')
    expect(container.querySelectorAll('.analytik-board > .analytik-block')).toHaveLength(2)
    expect(JSON.parse(localStorage.getItem('analytik:preferences') ?? '{}')).toMatchObject({ live: true })
    await click(live)
    await click(live)
    await click(live)
    expect(live?.getAttribute('aria-checked')).toBe('false')
    await actAsync(() => new Promise((resolve) => setTimeout(resolve, 700)))
    expect(api.find('PUT', '/preferences')).toHaveLength(1)
    expect(api.find('PUT', '/preferences')[0]?.body).toEqual({
      live: false,
      layout: [{ id: 'kpis', wide: true }, { id: 'goals' }],
    })
  })

  it('uploads the browser settings to an empty database and keeps them when saving fails', async () => {
    localStorage.setItem('analytik:preferences', JSON.stringify({ live: true }))
    const api = fakeApi({ 'PUT /preferences': () => Response.json({ error: 'read only' }, { status: 403 }) })
    const { container } = await open(api)
    await settled()
    expect(api.find('PUT', '/preferences')[0]?.body).toEqual({ live: true })
    const live = switchFor(container, 'Live')
    expect(live?.getAttribute('aria-checked')).toBe('true')
    await click(live)
    await actAsync(() => new Promise((resolve) => setTimeout(resolve, 700)))
    expect(api.find('PUT', '/preferences')).toHaveLength(2)
    expect(live?.getAttribute('aria-checked')).toBe('false')
    expect(JSON.parse(localStorage.getItem('analytik:preferences') ?? '{}')).toEqual({ live: false })
  })

  it('keeps the settings in the browser only with syncPreferences off', async () => {
    const api = fakeApi()
    const { container } = await render(<Dashboard api="/api" fetcher={api.fetcher} syncPreferences={false} />)
    await settled()
    await click(switchFor(container, 'Live'))
    await actAsync(() => new Promise((resolve) => setTimeout(resolve, 700)))
    expect(api.find('GET', '/preferences')).toHaveLength(0)
    expect(api.find('PUT', '/preferences')).toHaveLength(0)
    expect(JSON.parse(localStorage.getItem('analytik:preferences') ?? '{}')).toEqual({ live: true })
  })

  it('plots clicked numbers together and changes the summary while customizing', async () => {
    const { container } = await open()
    const tile = (label: string) =>
      [...container.querySelectorAll('button.analytik-stat')].find(
        (b) => b.querySelector('.analytik-stat-label')?.textContent === label,
      )
    const caption = () => container.querySelector('.analytik-overview figcaption')?.textContent
    const legend = () => texts(container, '.analytik-overview .analytik-legend-item')
    const focus = () => container.querySelector('.analytik-chart-focus strong')?.textContent
    expect(legend()).toEqual(['Visitors', 'Revenue'])
    await click(tile('Bounce rate'))
    expect(tile('Bounce rate')?.getAttribute('aria-pressed')).toBe('true')
    expect(focus()).toBe('Bounce rate over time')
    expect(caption()).toMatch(/^Bounce rate, 4 points/)
    expect(container.querySelector('.analytik-overview .analytik-legend')).toBeNull()

    await click(tile('Revenue'))
    await click(tile('Visit duration'))
    expect(focus()).toBe('Bounce rate, Revenue and Visit duration over time')
    expect(legend()).toEqual(['Bounce rate', 'Revenue', 'Visit duration'])
    expect(texts(container, '.analytik-overview table th[scope="col"]')).toEqual([
      'Time',
      'Bounce rate',
      'Revenue',
      'Visit duration',
    ])
    expect(tile('Revenue')?.querySelector<HTMLElement>('.analytik-marker')?.style.background).toBe(
      'var(--analytik-series-2)',
    )
    await click(tile('Conversion rate'))
    expect(byText(container, 'Up to 4 at once.', '.analytik-chart-focus span')).toBeDefined()
    await click(tile('Visitors'))
    expect(legend()).toHaveLength(4)
    await click(tile('Bounce rate'))
    expect(focus()).toBe('Revenue, Visit duration and Conversion rate over time')
    await click(byText(container, 'Back to visitors and revenue', 'button'))
    expect(caption()).toMatch(/^Visitors, Revenue, 4 points/)
    await click(tile('Revenue per visitor'))
    await click(tile('Revenue per visitor'))
    expect(container.querySelector('.analytik-chart-focus')).toBeNull()

    await click(byText(container, 'Customize', 'button'))
    expect(container.querySelectorAll('.analytik-stat-edit')).toHaveLength(7)
    await choose(selectTrigger(container, 'Number 1'), 'Pageviews')
    await click(container.querySelector('[aria-label="Remove Live now"]'))
    await click(byText(container, 'Add a number', 'button'))
    const chip = (label: string) => byText(container, label, '.analytik-chart-edit button')
    await click(chip('Revenue'))
    expect(chip('Visitors')?.hasAttribute('disabled')).toBe(true)
    await click(chip('Sessions'))
    await click(chip('Bounce rate'))
    await click(chip('Orders'))
    await click(chip('Pageviews'))
    expect(chip('Pageviews')?.hasAttribute('disabled')).toBe(true)
    await click(byText(container, 'Done', 'button'))
    expect(texts(container, '.analytik-overview .analytik-stat-label')).toEqual([
      'Pageviews',
      'Revenue',
      'Conversion rate',
      'Revenue per visitor',
      'Bounce rate',
      'Visit duration',
      'Visitors',
    ])
    expect(legend()).toEqual(['Visitors', 'Sessions', 'Bounce rate', 'Orders'])
    expect(JSON.parse(localStorage.getItem('analytik:preferences') ?? '{}')).toMatchObject({
      summary: { chart: ['visitors', 'sessions', 'bounceRate', 'orders'] },
    })
  })

  it('refreshes live while the page is visible', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const { container, api } = await open()
    const live = switchFor(container, 'Live')
    expect(live?.getAttribute('aria-checked')).toBe('false')
    await click(live)
    expect(live?.getAttribute('aria-checked')).toBe('true')
    const before = api.find('GET', '/sites/site_1/overview').length
    await actAsync(() => vi.advanceTimersByTime(60000))
    await settled()
    expect(api.find('GET', '/sites/site_1/overview').length).toBe(before + 1)
    await click(container.querySelector('[aria-label="Previous period"]'))
    expect(live?.getAttribute('aria-checked')).toBe('false')
    expect(live?.hasAttribute('data-disabled')).toBe(true)
  })

  it('switches sites and adds one in a dialog', async () => {
    const { container, api } = await open(fakeApi(), undefined, { siteId: 'site_2' })
    const site = () => selectTrigger(container, 'Site')
    expect(site()?.textContent).toBe('OOther')
    await choose(site(), 'Example')
    expect(api.find('GET', '/sites/site_1/overview').length).toBeGreaterThan(0)
    expect(site()?.textContent).toBe('EExample')
    const dialog = () => container.querySelector('[role="dialog"]')
    await choose(site(), 'Add website…')
    expect(byText(container, 'Add a website', '[role="dialog"] h2')).toBeDefined()
    expect(site()?.textContent).toBe('EExample')
    await click(dialog()?.querySelector('[aria-label="Close"]'))
    await settled()
    expect(dialog()).toBeNull()

    await choose(site(), 'Add website…')
    const submitButton = dialog()?.querySelector<HTMLButtonElement>('button[type="submit"]')
    expect(submitButton?.disabled).toBe(true)
    expect(comboboxInput(container, 'Timezone')?.value).toBe(
      timeZoneText(Intl.DateTimeFormat().resolvedOptions().timeZone),
    )
    await fill(byLabel(container, 'Name'), 'New')
    const domain = byLabel(container, 'Domain')
    await fill(domain, 'localhost:3000')
    expect(container.querySelector('.analytik-field-error')).toBeNull()
    await actAsync(() => domain?.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
    expect(container.querySelector('.analytik-field-error')?.textContent).toBe('Leave out the port.')
    expect(domain?.getAttribute('aria-invalid')).toBe('true')
    expect(domain?.getAttribute('aria-describedby')).toBe(container.querySelector('.analytik-field-error')?.id)
    await submit(dialog()?.querySelector('form'))
    expect(api.find('POST', '/sites')).toHaveLength(0)
    await fill(domain, 'localhost')
    expect(container.querySelector('.analytik-field-error')?.textContent).toMatch(/^Use the public domain/)
    await fill(domain, 'https://New.example.org/path?x')
    expect(container.querySelector('.analytik-field-error')).toBeNull()
    expect(domain?.closest('label')?.querySelector('.analytik-field-hint')?.textContent).toMatch(
      /^Tracked as new\.example\.org\. /,
    )
    await type(comboboxInput(container, 'Revenue currency'), 'EUR')
    await press(byText(document.body, 'EUR · Euro', '[role="option"] .analytik-menu-text > span'))
    await type(comboboxInput(container, 'Timezone'), 'Berlin')
    await press(byText(document.body, timeZoneText('Europe/Berlin'), '[role="option"] .analytik-menu-text > span'))
    await settled()
    expect(submitButton?.disabled).toBe(false)
    const retention = byLabel(container, 'Keep data for (days)')
    await fill(retention, '0')
    expect(container.querySelector('.analytik-field-error')?.textContent).toBe(
      'Use a whole number of days from 1 to 36500, or leave it empty.',
    )
    expect(submitButton?.disabled).toBe(true)
    await fill(retention, '90')
    expect(submitButton?.disabled).toBe(false)
    await submit(dialog()?.querySelector('form'))
    await settled()
    expect(api.find('POST', '/sites')[0]?.body).toMatchObject({
      name: 'New',
      domain: 'new.example.org',
      currency: 'EUR',
      timezone: 'Europe/Berlin',
      retentionDays: 90,
    })
    expect(dialog()).toBeNull()
    expect(container.querySelector('.analytik-toolbar h1')?.textContent).toBe('Settings')
    // A new site opens on its tracking code; later visits to the settings start at the general section again.
    expect(container.querySelector('.analytik-settings-nav [aria-current="page"]')?.textContent).toBe('Tracking code')
    await click(nav(container, 'Overview'))
    await click(nav(container, 'Settings'))
    expect(container.querySelector('.analytik-settings-nav [aria-current="page"]')?.textContent).toBe('General')
  })

  it('lists every site with its last 24 hours, revenue only where payments come in, and opens one', async () => {
    const { container, api } = await open(
      fakeApi({
        'GET /summary': () => [
          { siteId: 'site_1', visitors: 1200, revenue: 129_900, orders: 13, currency: 'EUR', online: 4 },
          { siteId: 'site_2', visitors: 1200, revenue: 0, orders: 0, currency: 'USD', online: 4 },
        ],
      }),
      'sites',
    )
    expect(container.querySelector('h1')?.textContent).toBe('All sites')
    const cards = [...container.querySelectorAll('.analytik-site-card')]
    expect(cards.map((c) => c.textContent)).toEqual([
      'EExampleexample.com1,200visitors in the last 24h4 online€1,299.00 · 13 orders',
      'OOtherother.org1,200visitors in the last 24h4 online',
    ])
    // One request for every site's numbers, none per card.
    const calls = api.find('GET', '/summary')
    expect(calls).toHaveLength(1)
    expect(Date.parse(calls[0]?.params.to ?? '') - Date.parse(calls[0]?.params.from ?? '')).toBe(86400000)
    expect(api.find('GET', '/sites/site_2/overview')).toHaveLength(0)
    await click(byText(container, 'Add website', 'button'))
    await settled()
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    await click(container.querySelector('[role="dialog"] [aria-label="Close"]'))
    await settled()
    await click(cards[1])
    await settled()
    expect(selectTrigger(container, 'Site')?.textContent).toBe('OOther')
    expect(nav(container, 'Overview')?.getAttribute('aria-current')).toBe('page')
  })

  it('sorts the sites by name, domain, visitors, revenue or orders and remembers the order', async () => {
    const api = fakeApi({
      'GET /summary': () => [
        { siteId: 'site_1', visitors: 50, revenue: 900, orders: 9, currency: 'EUR', online: 0 },
        { siteId: 'site_2', visitors: 80, revenue: 100, orders: 1, currency: 'USD', online: 0 },
        { siteId: 'site_3', visitors: 10, revenue: 5000, orders: 2, currency: 'EUR', online: 0 },
      ],
    })
    api.state.sites = [site, otherSite, { ...site, id: 'site_3', name: 'alpha', domain: 'zeta.net' }]
    const { container } = await open(api, 'sites')
    const names = () => texts(container, '.analytik-site-name strong')
    expect(names()).toEqual(['Example', 'Other', 'alpha'])
    const sortBy = async (label: string) => {
      await choose(selectTrigger(container, 'Sort sites by'), label)
      await settled()
    }
    await sortBy('Name')
    expect(names()).toEqual(['alpha', 'Example', 'Other'])
    await sortBy('Domain')
    expect(names()).toEqual(['Example', 'Other', 'alpha'])
    await sortBy('Visitors')
    expect(names()).toEqual(['Other', 'Example', 'alpha'])
    await sortBy('Revenue')
    expect(names()).toEqual(['alpha', 'Example', 'Other'])
    await sortBy('Orders')
    expect(names()).toEqual(['Example', 'alpha', 'Other'])
    await click(container.querySelector('[aria-label="Descending, switch to ascending"]'))
    expect(names()).toEqual(['Other', 'alpha', 'Example'])
    expect(JSON.parse(localStorage.getItem('analytik:preferences') ?? '{}')).toMatchObject({
      sitesSort: { by: 'orders', descending: false },
    })
  })

  it('shows a dash and an idle dot when a site card fails to load', async () => {
    const { container } = await open(
      fakeApi({ 'GET /summary': () => Response.json({ error: 'nope' }, { status: 500 }) }),
      'sites',
    )
    expect(texts(container, '.analytik-site-number')).toEqual(['–', '–'])
    expect(container.querySelectorAll('.analytik-site-card .analytik-live-dot[data-idle]')).toHaveLength(2)
  })

  it('asks for a first site and shows creation errors', async () => {
    const api = fakeApi({ 'POST /sites': () => Response.json({ error: 'Domain taken' }, { status: 409 }) })
    api.state.sites = []
    const { container } = await open(api)
    expect(container.querySelector('h1')?.textContent).toBe('Add your first website')
    expect(byText(container, 'Subdomains (app.example.com) are tracked under the same site.')).toBeDefined()
    await fill(byLabel(container, 'Name'), 'A')
    await fill(byLabel(container, 'Domain'), 'a.org')
    await submit(container.querySelector('form'))
    await settled()
    expect(container.querySelector('[role="alert"] .analytik-error-text')?.textContent).toBe('Domain taken.')
  })

  it('shows API errors', async () => {
    const { container } = await open(
      fakeApi({ 'GET /sites': () => Response.json({ error: 'Database down' }, { status: 500 }) }),
    )
    expect(container.querySelector('[role="alert"] .analytik-error-text')?.textContent).toBe('Database down.')
    const broken = await open(fakeApi({ 'GET /sites/:id/overview': () => new Response('x', { status: 502 }) }))
    expect(broken.container.querySelector('[role="alert"] .analytik-error-text')?.textContent).toBe('HTTP 502.')
  })
})

describe('Dashboard views', () => {
  it('Sources and Pages list every dimension', async () => {
    const { container, api } = await open(fakeApi(), 'sources')
    expect(texts(container, '[role="tab"]')).toEqual([
      'Channel',
      'Source',
      'Referrer',
      'Campaign',
      'Medium',
      'Term',
      'Content',
      'Ref code',
    ])
    await click(nav(container, 'Pages'))
    await settled()
    expect(texts(container, '[role="tab"]')).toEqual(['Page', 'Entry page', 'Exit page'])
    expect(api.find('GET', '/sites/site_1/breakdown').map((r) => r.params.dimension)).toEqual(['channel', 'page'])
  })

  it('Events lists goals and recent events, filtered by the goal filter and by type', async () => {
    const { container, api } = await open(fakeApi(), 'events')
    expect(texts(container, '[role="tab"]')).toEqual(['Goal', 'Event', 'Outbound link'])
    expect(texts(container, 'tbody td').slice(0, 4)).toEqual(['Oct 26, 2026, 10:00 AM', 'goal', 'signup', '/pricing'])
    await click(byText(container, 'goal-a', '.analytik-bar-label')?.closest('button'))
    await settled()
    expect(api.find('GET', '/sites/site_1/events').at(-1)?.params).toMatchObject({ name: 'goal-a', goal: 'goal-a' })
    expect(byText(container, '“goal-a” events', 'h2')).toBeDefined()
    await choose(selectTrigger(container, 'Type'), 'Pageviews')
    await settled()
    expect(api.find('GET', '/sites/site_1/events').at(-1)?.params.type).toBe('pageview')
    await click(container.querySelector('tbody .analytik-row-button'))
    await settled()
    expect(texts(document.body, '[role="dialog"] .analytik-timeline li')).toEqual([
      '+0spageview/pricing',
      '+42sgoalsignup',
    ])
  })

  it('Revenue shows revenue stats, chart, breakdown by revenue and payments', async () => {
    const { container, api } = await open(fakeApi(), 'revenue')
    expect(texts(container, '.analytik-stat-label')).toEqual([
      'Revenue',
      'Orders',
      'Conversion rate',
      'Revenue per visitor',
    ])
    expect(texts(container, '.analytik-bars .analytik-bar-label')).toEqual(['Organic Search'])
    expect(texts(container, '.analytik-bars .analytik-bar-value')).toEqual(['€99.00'])
    const rows = [...container.querySelectorAll('.analytik-table tbody tr')].map((tr) => texts(tr, 'td'))
    expect(rows).toHaveLength(2)
    expect(rows[0]?.slice(2)).toEqual(['€49.90renewal', 'Stripe', 'Checkout metadata', ''])
    expect(rows[1]?.slice(2)).toEqual(['-€49.90refund', 'Stripe', 'Unattributed', ''])
    await choose(selectTrigger(container, 'Kind'), 'Refunds')
    await settled()
    await choose(selectTrigger(container, 'Attribution'), 'Attributed')
    await settled()
    await click(byText(container, 'Amount', 'th button'))
    await settled()
    expect(api.find('GET', '/sites/site_1/payments').at(-1)?.params).toMatchObject({
      kind: 'refund',
      attributed: 'true',
      sort: 'amount',
      order: 'desc',
      offset: '0',
      limit: '25',
    })
  })

  it('Sessions pages, sorts, searches and filters, and opens a visitor timeline', async () => {
    const { container, api } = await open(fakeApi(), 'sessions')
    const last = () => api.find('GET', '/sites/site_1/sessions').at(-1)?.params
    expect(container.querySelector('.analytik-count')?.textContent).toBe('30')
    expect(container.querySelector('.analytik-pager')?.textContent).toContain('1–25 of 30')
    expect(texts(container, 'tbody tr:first-child td').slice(1)).toEqual([
      'Oct 26, 2026, 10:00 AM',
      expect.stringContaining('Berlin'),
      expect.stringContaining('news.ycombinator.com'),
      'desktop',
      expect.stringContaining('Firefox'),
      expect.stringContaining('/pricing'),
      '3',
      '2m 5s',
      '€49.90',
      '',
    ])
    await click(container.querySelector('[aria-label="Page 2"]'))
    await settled()
    expect(last()?.offset).toBe('25')
    expect(container.querySelector('.analytik-page[aria-current="page"]')?.textContent).toBe('2')
    expect(container.querySelector('[aria-label="Next page"]')?.hasAttribute('disabled')).toBe(true)

    const duration = byText(container, 'Duration', 'th button')
    await click(duration)
    await settled()
    expect(last()).toMatchObject({ sort: 'duration', order: 'desc', offset: '0' })
    expect(duration?.closest('th')?.getAttribute('aria-sort')).toBe('descending')
    await click(duration)
    await settled()
    expect(last()).toMatchObject({ sort: 'duration', order: 'asc' })
    await click(duration)
    await settled()
    // Back to the default order: the first page in that order is still cached, so no new request.
    expect(duration?.closest('th')?.hasAttribute('aria-sort')).toBe(false)

    await choose(selectTrigger(container, 'Rows per page'), '50 per page')
    await settled()
    expect(last()?.limit).toBe('50')
    await choose(selectTrigger(container, 'Channel'), 'Referral')
    await settled()
    expect(last()?.channel).toBe('Referral')

    await fill(container.querySelector('input[type="search"]'), ' pricing ')
    await waitFor(() => last()?.search === 'pricing')
    await click(byText(container, 'Clear', '.analytik-table-tools button'))
    await settled()
    // Cleared back to an earlier list, which comes from the cache.
    expect(container.querySelector<HTMLInputElement>('input[type="search"]')?.value).toBe('')
    expect(selectTrigger(container, 'Channel')?.textContent).not.toContain('Referral')

    await click(container.querySelector('tbody .analytik-row-button'))
    await settled()
    const dialog = document.querySelector('[role="dialog"]')
    expect(texts(document.body, '[role="dialog"] .analytik-timeline li')).toEqual([
      '+0spageview/pricing',
      '+42sgoalsignup',
    ])
    expect(dialog?.textContent).toContain('Firefox')
    await key(dialog, 'Escape')
    await settled()
  })

  it('Sessions filter by browser and by a visitor, and copy visitor ids', async () => {
    const writes: string[] = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (text: string) => (writes.push(text), Promise.resolve()) },
    })
    const { container, api } = await open(fakeApi(), 'sessions')
    const last = () => api.find('GET', '/sites/site_1/sessions').at(-1)?.params
    await choose(selectTrigger(container, 'Browser'), 'browser-a')
    await settled()
    expect(last()?.browser).toBe('browser-a')
    const copy = container.querySelector('tbody [aria-label="Copy visitor id"]')
    await click(copy)
    await settled()
    expect(writes).toEqual(['vis_1'])
    expect(copy?.hasAttribute('data-done')).toBe(true)
    expect(copy?.getAttribute('aria-label')).toBe('Copied')
    // The copy button is inside the row button's cell but does not open the visit.
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await click(container.querySelector('tbody [aria-label="Show only this visitor"]'))
    await settled()
    expect(last()?.visitor).toBe('vis_1')
    expect(container.querySelector('.analytik-filter-chip')?.textContent).toBe('Visitorvis_1')
    await click(container.querySelector('[aria-label="Remove the visitor filter"]'))
    await settled()
    expect(container.querySelector('.analytik-filter-chip')).toBeNull()
  })

  it('Events and payments narrow to one visitor', async () => {
    const { container, api } = await open(fakeApi(), 'events')
    await click(container.querySelector('tbody [aria-label="Show only this visitor"]'))
    await settled()
    expect(api.find('GET', '/sites/site_1/events').at(-1)?.params.visitor).toBe('vis_1')
    await click(nav(container, 'Revenue'))
    await settled()
    expect(container.querySelector('tbody [aria-label="Copy customer id"]')).not.toBeNull()
    await click(container.querySelector('tbody [aria-label="Show only this visitor"]'))
    await settled()
    expect(api.find('GET', '/sites/site_1/payments').at(-1)?.params.visitor).toBe('vis_1')
  })

  it('Sessions shows an empty state that clears its filters', async () => {
    const api = fakeApi({
      'GET /sites/:id/sessions': ({ params }) => ({
        items: params.search ? [] : [],
        nextCursor: null,
        total: 0,
      }),
    })
    const { container } = await open(api, 'sessions')
    expect(container.querySelector('.analytik-empty')?.textContent).toContain('No sessions in this period')
    expect(container.querySelector('.analytik-pager')).toBeNull()
    await fill(container.querySelector('input[type="search"]'), 'nothing')
    await waitFor(() => container.querySelector('.analytik-empty')?.textContent.includes('Nothing matches'))
    await click(byText(container, 'Clear filters', 'button'))
    await settled()
    expect(container.querySelector('.analytik-empty')?.textContent).toContain('No sessions in this period')
  })

  it('Funnels shows conversion per step, creates and deletes funnels', async () => {
    const { container, api } = await open(fakeApi(), 'funnels')
    expect(texts(container, '.analytik-funnel li')).toEqual(['1. /1,000 · 100%', '2. signup250 · 25% · 75% dropped'])
    await fill(byLabel(container, 'Funnel name'), 'Checkout')
    await submit(container.querySelector('form'))
    expect(container.querySelector('[role="alert"] .analytik-error-text')?.textContent).toBe(
      'A funnel needs at least two steps.',
    )
    await click(byText(container, 'Add step', 'button'))
    const matches = container.querySelectorAll<HTMLInputElement>('fieldset input.analytik-input')
    await fill(matches[0], '/cart')
    await choose(selectTrigger(container, 'Step 2'), 'Goal')
    await fill(container.querySelectorAll<HTMLInputElement>('fieldset input.analytik-input')[1], 'purchase')
    await click(container.querySelector('[aria-label="Remove step 3"]'))
    await submit(container.querySelector('form'))
    await settled()
    expect(api.find('POST', '/sites/site_1/funnels')[0]?.body).toEqual({
      name: 'Checkout',
      steps: [
        { type: 'page', match: '/cart' },
        { type: 'goal', match: 'purchase' },
      ],
    })
    expect(selectTrigger(container, 'Funnel')?.textContent).toBe('Checkout')
    await choose(selectTrigger(container, 'Funnel'), 'Signup')
    await click(byText(container, 'Delete', 'button'))
    await settled()
    expect(byText(container, 'Delete the funnel “Signup”?', '[role="dialog"] h2')).toBeDefined()
    await click(byText(container, 'Delete funnel', '[role="dialog"] button'))
    await settled()
    expect(api.find('DELETE', '/sites/site_1/funnels/f1')).toHaveLength(1)
    expect(container.querySelector('.analytik-card h2')?.textContent).toBe('Checkout')
  })

  it('Funnels reports failures and an empty list', async () => {
    const api = fakeApi({ 'POST /sites/:id/funnels': () => Response.json({ error: 'Invalid step' }, { status: 400 }) })
    api.state.funnels = []
    const { container } = await open(api, 'funnels')
    expect(container.querySelector('.analytik-empty')?.textContent).toContain('No funnels yet')
    await fill(byLabel(container, 'Funnel name'), 'X')
    const inputs = container.querySelectorAll<HTMLInputElement>('fieldset input.analytik-input')
    await fill(inputs[0], '/a')
    await fill(inputs[1], '/b')
    await submit(container.querySelector('form'))
    await settled()
    expect(container.querySelector('[role="alert"] .analytik-error-text')?.textContent).toBe('Invalid step.')
  })

  it('Realtime maps who is online, describes what they do and refreshes while visible', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
    const { container, api } = await open(fakeApi(), 'realtime')
    expect(container.querySelector('.analytik-range')).toBeNull()
    expect(container.querySelector('.analytik-live-count')?.textContent).toBe('3 visitors on example.com')
    const [recent, older] = texts(container, '.analytik-timeline li')
    expect(recent).toMatch(/^Visitor from Germany visited \/pricing\d+s ago$/)
    expect(older).toBe('A visitor completed signup1m ago')
    expect(container.querySelector('.analytik-map')?.getAttribute('aria-label')).toBe(
      'Visitor locations: Berlin, Germany (2), Unknown location (1)',
    )
    expect(container.querySelectorAll('.analytik-map-marker')).toHaveLength(1)
    await actAsync(() => vi.advanceTimersByTime(10000))
    await settled()
    expect(api.find('GET', '/sites/site_1/realtime')).toHaveLength(2)
    // Nothing changed, so the next poll waits twice as long.
    await actAsync(() => vi.advanceTimersByTime(10000))
    await settled()
    expect(api.find('GET', '/sites/site_1/realtime')).toHaveLength(2)
    await actAsync(() => vi.advanceTimersByTime(10000))
    await settled()
    expect(api.find('GET', '/sites/site_1/realtime')).toHaveLength(3)
  })

  it('Realtime switches to a globe, a light map and back to the overview', async () => {
    const { container } = await open(fakeApi(), 'realtime')
    const button = (label: string) => container.querySelector(`[aria-label="${label}"]`)
    expect(container.querySelector('.analytik-map > circle')).toBeNull()
    await click(button('Globe view'))
    expect(button('Globe view')?.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('.analytik-map > circle')).not.toBeNull()
    const map = container.querySelector<SVGSVGElement>('.analytik-map')!
    const land = () => container.querySelector('.analytik-map-land')?.getAttribute('d')
    const facing = land()
    const pointer = (type: string, x: number, y: number) =>
      actAsync(() => map.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y })))
    await pointer('pointerdown', 100, 50)
    await pointer('pointermove', 160, 70)
    await pointer('pointerup', 160, 70)
    const dragged = land()
    expect(dragged).not.toBe(facing)
    await pointer('pointermove', 200, 90)
    expect(land()).toBe(dragged)
    await actAsync(() => map.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })))
    expect(land()).not.toBe(dragged)
    const turned = land()
    await actAsync(() => map.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(land()).toBe(turned)
    await click(button('Close real-time view'))
    await settled()
    expect(nav(container, 'Overview')?.getAttribute('aria-current')).toBe('page')
    // The globe is remembered for the next visit.
    await click(nav(container, 'Live'))
    await settled()
    expect(container.querySelector('.analytik-map > circle')).not.toBeNull()
  })

  it('Realtime shows a tooltip on a marker and the visitors there on a click', async () => {
    const { container } = await open(fakeApi(), 'realtime')
    expect(container.querySelector('.analytik-map')?.getAttribute('role')).toBe('group')
    const marker = container.querySelector('[data-place="52.52,13.4"]')
    expect(marker?.getAttribute('aria-label')).toBe('Berlin, Germany: 2 visitors. Show details.')
    await actAsync(() => marker?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })))
    await settled()
    expect(container.querySelector('[role="tooltip"].analytik-map-tip')?.textContent).toBe(
      'Berlin, Germany2 visitors · /pricingClick for details',
    )
    await actAsync(() => marker?.dispatchEvent(new PointerEvent('pointerout', { bubbles: true })))
    await settled()
    expect(container.querySelector('.analytik-map-tip')).toBeNull()
    await key(marker, 'Enter')
    await settled()
    const card = container.querySelector('.analytik-place-card')
    expect(card?.querySelector('h3')?.textContent).toBe('Berlin, Germany')
    expect(texts(card!, '.analytik-place-page')).toEqual(['/pricing', '/docs'])
    expect(marker?.getAttribute('aria-pressed')).toBe('true')
    await click(card?.querySelector('.analytik-place-visit'))
    await settled()
    expect(texts(document.body, '[role="dialog"] .analytik-timeline li')).toHaveLength(2)
    await key(document.querySelector('[role="dialog"]'), 'Escape')
    await settled()
    await click(container.querySelector('[aria-label="Close details"]'))
    await settled()
    expect(container.querySelector('.analytik-place-card')).toBeNull()
    // A click toggles the details; a press on a marker never starts a globe drag.
    await click(marker)
    await settled()
    expect(container.querySelector('.analytik-place-card')).not.toBeNull()
    await click(marker)
    await settled()
    expect(container.querySelector('.analytik-place-card')).toBeNull()
  })

  it('Realtime plays a tone for new visits once sound is on', async () => {
    const tones: number[] = []
    class FakeAudio {
      currentTime = 0
      destination = {}
      createOscillator() {
        return {
          frequency: { value: 0 },
          connect: (node: unknown) => node,
          start: () => tones.push(1),
          stop: () => undefined,
        }
      }
      createGain() {
        const gain = { setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined }
        return { gain, connect: (node: unknown) => node }
      }
    }
    vi.stubGlobal('AudioContext', FakeAudio)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
    let latest = Date.now()
    const api = fakeApi({
      'GET /sites/:id/realtime': () => ({
        ...realtime,
        recent: [{ ts: latest, type: 'pageview', name: null, path: '/', country: null }],
      }),
    })
    const { container } = await open(api, 'realtime')
    await click(container.querySelector('[aria-label="Sound on new visits"]'))
    latest += 1000
    await actAsync(() => vi.advanceTimersByTime(10000))
    await settled()
    expect(tones).toHaveLength(1)
    await click(container.querySelector('[aria-label="Sound on new visits"]'))
    latest += 1000
    await actAsync(() => vi.advanceTimersByTime(10000))
    await settled()
    expect(tones).toHaveLength(1)
    vi.unstubAllGlobals()
  })

  it('Realtime toggles full screen where the browser allows it', async () => {
    const request = vi.fn(() => Promise.resolve())
    const exit = vi.fn(() => Promise.resolve())
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true })
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit })
    HTMLElement.prototype.requestFullscreen = request
    const { container } = await open(fakeApi(), 'realtime')
    await click(container.querySelector('[aria-label="Full screen"]'))
    expect(request).toHaveBeenCalledTimes(1)
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: container })
    await click(container.querySelector('[aria-label="Full screen"]'))
    expect(exit).toHaveBeenCalledTimes(1)
    for (const prop of ['fullscreenEnabled', 'exitFullscreen', 'fullscreenElement'])
      Reflect.deleteProperty(document, prop)
  })

  it('Realtime handles an empty site', async () => {
    const { container } = await open(
      fakeApi({ 'GET /sites/:id/realtime': () => ({ online: 0, recent: [], locations: [] }) }),
      'realtime',
    )
    expect(byText(container, 'Nobody here right now')).toBeDefined()
    expect(container.querySelector('.analytik-live-count')?.textContent).toBe('0 visitors on example.com')
    expect(container.querySelector('.analytik-map')?.getAttribute('aria-label')).toBe('Map with no visitor locations')
  })

  it('filtering from a view without a range goes back to the overview', async () => {
    const { container } = await open(fakeApi(), 'realtime')
    await click(nav(container, 'Overview'))
    await settled()
    expect(container.querySelector('.analytik-toolbar h1')?.textContent).toBe('Overview')
    expect(nav(container, 'Overview')?.getAttribute('aria-current')).toBe('page')
  })
})

/** Opens a settings section from the list on the left. */
async function section(container: Element, label: string): Promise<void> {
  await click(byText(container, label, '.analytik-settings-nav button'))
  await settled()
}

/** Clicks a button in the open dialog. */
async function inDialog(container: Element, label: string): Promise<void> {
  await click(byText(container, label, '[role="dialog"] button'))
  await settled()
}

describe('Settings', () => {
  it('saves the general and the privacy settings separately', async () => {
    const { container, api } = await open(fakeApi(), 'settings')
    await fill(byLabel(container, 'Name'), 'Renamed')
    await fill(byLabel(container, 'Domain'), '192.168.0.1')
    await submit(container.querySelector('form'))
    expect(api.find('PATCH', '/sites/site_1')).toHaveLength(0)
    expect(container.querySelector('.analytik-field-error')?.textContent).toBe('Use a domain name, not an IP address.')
    await fill(byLabel(container, 'Domain'), ' new.org ')
    await type(comboboxInput(container, 'Currency'), 'swiss')
    await press(byText(document.body, 'CHF · Swiss Franc', '[role="option"] .analytik-menu-text > span'))
    await type(comboboxInput(container, 'Timezone'), 'Berlin')
    await press(byText(document.body, timeZoneText('Europe/Berlin'), '[role="option"] .analytik-menu-text > span'))
    await submit(container.querySelector('form'))
    await settled()
    expect(api.find('PATCH', '/sites/site_1')[0]?.body).toEqual({
      name: 'Renamed',
      domain: 'new.org',
      timezone: 'Europe/Berlin',
      currency: 'CHF',
    })
    expect(byText(container, 'Settings saved', '[role="status"]')).toBeDefined()

    await section(container, 'Privacy')
    await fill(byLabel(container, 'Keep data for (days)'), '365')
    await fill(byLabel(container, 'Ignored IP addresses'), '1.2.3.4\n 5.6.7.8 ,')
    await click(container.querySelector('input[value="persistent"]'))
    await click(switchFor(container, 'Accept events from localhost (for testing; turn off once live)'))
    await submit(container.querySelector('form'))
    await settled()
    expect(api.find('PATCH', '/sites/site_1')[1]?.body).toEqual({
      privacyMode: 'persistent',
      retentionDays: 365,
      allowLocalhost: true,
      ignoredIps: ['1.2.3.4', '5.6.7.8'],
    })
    await fill(byLabel(container, 'Keep data for (days)'), '')
    await submit(container.querySelector('form'))
    await settled()
    expect((api.find('PATCH', '/sites/site_1')[2]?.body as { retentionDays: unknown }).retentionDays).toBeNull()
  })

  it('reports a failed save', async () => {
    const { container } = await open(
      fakeApi({ 'PATCH /sites/:id': () => Response.json({ error: 'Invalid domain' }, { status: 400 }) }),
      'settings',
    )
    await submit(container.querySelector('form'))
    await settled()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Invalid domain')
  })

  it('hides a success message after a moment', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
    try {
      const { container } = await open(fakeApi(), 'settings')
      await submit(container.querySelector('form'))
      await settled()
      expect(byText(container, 'Settings saved', '[role="status"]')).toBeDefined()
      await actAsync(() => vi.advanceTimersByTime(3000))
      await settled()
      expect(container.querySelector('[role="status"] .analytik-notice')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('generates the snippet and copies it', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const { container } = await open(fakeApi(), 'settings')
    await section(container, 'Tracking code')
    const snippet = () => container.querySelector('[aria-label="Snippet"]')?.textContent
    expect(snippet()).toBe(`<script defer src="${location.origin}/analytik.js" data-site="site_1"></script>`)
    await choose(selectTrigger(container, 'Mode'), 'Enriched')
    await fill(byLabel(container, 'Keep query parameters'), 'page')
    await click(switchFor(container, 'Track clicks on outbound links'))
    await click(switchFor(container, 'Wait for an interaction or 3 seconds on screen before counting (filters bots)'))
    await choose(selectTrigger(container, 'Activity updates'), 'Only when leaving')
    expect(snippet()).toBe(
      `<script defer src="${location.origin}/analytik.js" data-site="site_1" data-mode="enriched" data-require-interaction="false" data-auto-outbound="false" data-keep-query="page" data-ping-interval="0"></script>`,
    )
    await click(byText(container, 'Copy snippet', 'button'))
    await settled()
    expect(writeText).toHaveBeenCalledWith(snippet())
    expect(byText(container, 'Copied', '[role="status"]')).toBeDefined()
    writeText.mockRejectedValueOnce(new Error('denied'))
    await click(byText(container, 'Copy snippet', 'button'))
    await settled()
    expect(byText(container, 'Copy failed, select the text instead', '[role="alert"]')).toBeDefined()
  })

  it('builds campaign links with a preview', async () => {
    const { container } = await open(fakeApi(), 'settings')
    await section(container, 'Campaign links')
    expect(byText(container, 'Enter a full page URL and a source.')).toBeDefined()
    await fill(byLabel(container, 'Page URL'), 'https://example.com/pricing')
    await fill(byLabel(container, 'Source (required)'), 'newsletter')
    await fill(byLabel(container, 'Campaign'), 'launch')
    expect(container.querySelector('[aria-label="Campaign link"]')?.textContent).toBe(
      'https://example.com/pricing?utm_source=newsletter&utm_campaign=launch',
    )
    expect([...container.querySelectorAll('.analytik-url-param')].map((p) => p.textContent)).toEqual([
      '?utm_source=newsletter',
      '&utm_campaign=launch',
    ])
    expect([...container.querySelectorAll('.analytik-params > [data-set] dt')].map((d) => d.textContent)).toEqual([
      'utm_source',
      'utm_campaign',
    ])
  })

  it('rotates the API key after confirming and saves webhook secrets', async () => {
    const { container, api } = await open(fakeApi(), 'settings')
    await section(container, 'Payments and API')
    await click(byText(container, 'Rotate key', '.analytik-card button'))
    await settled()
    expect(byText(container, 'Rotate the API key?', '[role="dialog"] h2')).toBeDefined()
    await inDialog(container, 'Cancel')
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(api.find('POST', '/sites/site_1/rotate-key')).toHaveLength(0)
    await click(byText(container, 'Rotate key', '.analytik-card button'))
    await settled()
    await inDialog(container, 'Rotate key')
    expect(container.querySelector('[aria-label="New API key"]')?.textContent).toBe('ak_live_123')

    const stripe = byText(container, 'Stripe', 'h3')?.closest('form')
    expect(stripe?.querySelector<HTMLInputElement>('input[readonly]')?.value).toBe(
      `${location.origin}/api/webhooks/stripe/site_1`,
    )
    await fill(stripe?.querySelector('input[type="password"]'), 'whsec_1')
    await submit(stripe)
    await settled()
    expect(api.find('PATCH', '/sites/site_1')[0]?.body).toEqual({ webhookSecrets: { stripe: 'whsec_1' } })
    expect(byText(container, 'Stripe secret saved', '[role="status"]')).toBeDefined()
  })

  it('exports, re-runs attribution and deletes old data after confirming', async () => {
    const { container, api } = await open(fakeApi(), 'settings')
    await section(container, 'Data')
    expect([...container.querySelectorAll('a[download]')].map((a) => a.getAttribute('href'))).toEqual([
      '/api/sites/site_1/export?format=json',
      '/api/sites/site_1/export?format=csv',
    ])
    await click(byText(container, 'Re-run payment attribution', 'button'))
    await settled()
    expect(api.find('POST', '/sites/site_1/rematch')).toHaveLength(1)
    expect(byText(container, 'Delete', '.analytik-card button')?.hasAttribute('disabled')).toBe(true)
    await click(container.querySelector('.analytik-date-trigger'))
    await settled()
    expect(container.querySelector('.analytik-calendar')).not.toBeNull()
    const firstDay = container.querySelector<HTMLElement>('.analytik-day:not([data-outside])')!
    const picked = firstDay.dataset.day!
    await click(firstDay)
    await settled()
    expect(container.querySelector('.analytik-calendar')).toBeNull()
    await click(byText(container, 'Delete', '.analytik-card button'))
    await settled()
    expect(byText(container, `Delete everything before ${picked}?`, '[role="dialog"] h2')).toBeDefined()
    await inDialog(container, 'Delete data')
    expect(api.find('DELETE', '/sites/site_1/data')[0]?.params.before).toBe(
      new Date(`${picked}T00:00:00`).toISOString(),
    )
    expect(byText(container, 'Data deleted', '[role="status"]')).toBeDefined()
  })

  it('says per privacy mode what it stores and whether it needs a cookie banner', async () => {
    const { container } = await open(fakeApi(), 'settings')
    await section(container, 'Privacy')
    expect(texts(container, '.analytik-mode-banner')).toEqual([
      'No cookie banner needed',
      'Cookie banner needed for the extra id',
      'Cookie banner required in the EU',
    ])
    expect(container.querySelector('.analytik-mode-banner')?.getAttribute('data-need')).toBe('none')
    const info = container.querySelector<HTMLElement>('[aria-label="What Persistent mode means"]')
    await actAsync(() => info?.focus())
    await waitFor(() => document.body.querySelector('.analytik-tooltip[data-rich]'))
    const facts = document.body.querySelector('.analytik-mode-facts')?.textContent
    expect(facts).toContain('analytik_vid')
    expect(facts).toContain('Cookie banner')
  })

  it('offers a prompt that has a coding assistant add the tracker', async () => {
    const { container } = await open(fakeApi(), 'settings')
    await section(container, 'Tracking code')
    const preview = await waitFor(() => container.querySelector('.analytik-prompt-preview'))
    expect(preview.textContent).toContain('# Add Analytik tracking to your Plain HTML site')
    expect(preview.textContent).toContain('data-site="site_1"')
    await choose(selectTrigger(container, 'Framework or platform'), 'Vue')
    await waitFor(() => container.querySelector('.analytik-prompt-preview')?.textContent.includes('your Vue site'))
    expect(byText(container, 'Copy prompt', 'button')).toBeDefined()
  })

  it('hides the debug section when the server has the debug tools off', async () => {
    const { container, api } = await open(fakeApi(), 'settings')
    expect(api.find('GET', '/debug')).toHaveLength(1)
    expect(container.querySelector('.analytik-settings-nav li[data-tone="debug"]')).toBeNull()
  })

  it('generates test data from a preset or custom amounts and removes test sites', async () => {
    const api = fakeApi()
    api.state.debug = true
    const { container } = await open(api, 'settings')
    await section(container, 'Debug')
    const estimate = () => container.querySelector('.analytik-debug-estimate')?.textContent
    expect(estimate()).toBe('About 6,000 visits and 16.8K events.')

    const preset = (value: string) => container.querySelector<HTMLInputElement>(`input[value="${value}"]`)
    await click(preset('stress'))
    expect(byLabel(container, 'Days of history')?.value).toBe('730')
    expect(estimate()).toContain('takes a minute or more')
    await fill(byLabel(container, 'Visits per day'), '5000')
    expect(estimate()).toBe("That's 3.7M visits; one run writes at most 1M.")
    expect(byText(container, 'Generate', 'button')?.hasAttribute('disabled')).toBe(true)
    expect(preset('stress')?.checked).toBe(false)

    await fill(byLabel(container, 'Visits per day'), '0')
    expect(estimate()).toBe('An empty site with no visits yet, to see the dashboard before any data arrives.')
    expect(byText(container, 'Generate', 'button')?.hasAttribute('disabled')).toBe(false)
    await fill(byLabel(container, 'Days of history'), '-1')
    expect(estimate()).toBe('Days go from 0 to 730.')

    await click(preset('busy'))
    await choose(selectTrigger(container, 'Write into'), 'This site (Example)')
    expect(byLabel(container, 'Sites')).toBeUndefined()
    const sitesBefore = api.find('GET', '/sites').length
    await click(byText(container, 'Generate', 'button'))
    await settled()
    expect(api.find('POST', '/debug/generate')[0]?.body).toEqual({
      siteId: 'site_1',
      days: 90,
      visitorsPerDay: 3000,
      priceScale: 1,
    })
    expect(container.querySelector('.analytik-card-actions [role="status"]')?.textContent).toBe(
      'Added 6,020 visits from 5,210 visitors, 16,844 events and 151 payments to Test site a1 in 1.8 s',
    )
    expect(api.find('GET', '/sites').length).toBeGreaterThan(sitesBefore)

    await choose(selectTrigger(container, 'Write into'), 'New test sites')
    await fill(byLabel(container, 'Sites'), '3')
    await fill(byLabel(container, 'Price multiplier'), '10000')
    await click(byText(container, 'Generate', 'button'))
    await settled()
    expect(api.find('POST', '/debug/generate')[1]?.body).toEqual({
      sites: 3,
      days: 90,
      visitorsPerDay: 3000,
      priceScale: 10000,
      currency: 'EUR',
    })

    await click(preset('mix'))
    expect(byLabel(container, 'Visits per day')).toBeUndefined()
    expect(byLabel(container, 'Price multiplier')).toBeUndefined()
    expect(estimate()).toMatch(
      /^10 different sites \(busy shop, empty site, .*premium SaaS, .*personal site\): about 605\.2K visits\. A run this big/,
    )
    await fill(byLabel(container, 'Sites'), '2')
    expect(estimate()).toBe('2 different sites (busy shop, empty site): about 150K visits.')
    await click(byText(container, 'Generate', 'button'))
    await settled()
    expect(api.find('POST', '/debug/generate')[2]?.body).toEqual({ sites: 2, days: 60, mix: true, currency: 'EUR' })
    await choose(selectTrigger(container, 'Traffic'), 'Same on every site')
    expect(byLabel(container, 'Visits per day')?.value).toBe('400')

    await click(byText(container, 'Delete test sites', '.analytik-card button'))
    await settled()
    await inDialog(container, 'Delete test sites')
    expect(api.find('DELETE', '/debug/sites')).toHaveLength(1)
    expect(byText(container, 'Deleted 3 test sites', '[role="status"]')).toBeDefined()
  })
})

describe('site lifecycle', () => {
  it('pauses and resumes tracking from the general settings', async () => {
    const { container, api } = await open(fakeApi(), 'settings')
    expect(container.querySelector('.analytik-tracking-state')?.textContent).toBe('Tracking is on')
    await click(byText(container, 'Pause tracking', 'button'))
    await settled()
    expect(api.find('PATCH', '/sites/site_1')[0]?.body).toEqual({ paused: true })
    expect(container.querySelector('.analytik-tracking-state')?.textContent).toBe('Tracking is paused')
    expect(byText(container, 'Tracking paused', '[role="status"]')).toBeDefined()
    await click(byText(container, 'Resume tracking', 'button'))
    await settled()
    expect(api.find('PATCH', '/sites/site_1')[1]?.body).toEqual({ paused: false })
  })

  it('deletes the site after the admin password, then shows all sites', async () => {
    const { container, api } = await open(fakeApi(), 'settings')
    await click(byText(container, 'Delete website', '.analytik-card button'))
    await settled()
    const dialog = () => document.querySelector('[role="dialog"]')
    expect(dialog()?.querySelector('h2')?.textContent).toBe('Delete Example?')
    const submitButton = () => byText(document.body, 'Delete website', '[role="dialog"] button')
    expect(submitButton()?.hasAttribute('disabled')).toBe(true)
    await fill(byLabel(document.body, 'Admin password'), 'guess')
    expect(submitButton()?.hasAttribute('disabled')).toBe(true)
    await fill(byLabel(document.body, 'Type example.com to confirm'), 'example.co')
    expect(submitButton()?.hasAttribute('disabled')).toBe(true)
    await fill(byLabel(document.body, 'Type example.com to confirm'), ' Example.com ')
    expect(submitButton()?.hasAttribute('disabled')).toBe(false)
    await submit(dialog()?.querySelector('form'))
    await settled()
    expect(dialog()?.querySelector('[role="alert"] .analytik-error-text')?.textContent).toBe('Wrong password.')
    expect(api.state.sites).toHaveLength(2)
    await fill(byLabel(document.body, 'Admin password'), 'secret')
    await submit(dialog()?.querySelector('form'))
    await settled()
    expect(api.find('DELETE', '/sites/site_1').at(-1)?.body).toEqual({ confirm: 'example.com', password: 'secret' })
    expect(api.state.sites.map((s) => s.id)).toEqual(['site_2'])
    expect(container.querySelector('h1')?.textContent).toBe('All sites')
  })

  it('asks for the domain when admins sign in through verify()', async () => {
    const api = fakeApi()
    api.state.login = 'custom'
    const { container } = await open(api, 'settings')
    await click(byText(container, 'Delete website', '.analytik-card button'))
    await settled()
    expect(byLabel(document.body, 'Admin password')).toBeUndefined()
    await fill(byLabel(document.body, 'Type example.com to confirm'), 'example.com')
    await submit(document.querySelector('[role="dialog"] form'))
    await settled()
    expect(api.find('DELETE', '/sites/site_1')[0]?.body).toEqual({ confirm: 'example.com' })
  })

  it('pauses and deletes from the menu on a site card', async () => {
    const { container, api } = await open(fakeApi(), 'sites')
    await click(container.querySelector('[aria-label="Actions for Other"]'))
    await settled()
    await press(byText(document.body, 'Pause tracking', '[role="menuitem"]'))
    await settled()
    expect(api.find('PATCH', '/sites/site_2')[0]?.body).toEqual({ paused: true })
    expect(texts(container, '.analytik-site-item[data-paused] .analytik-site-name strong')).toEqual(['Other'])
    expect(texts(container, '.analytik-badge[data-tone="paused"]')).toEqual(['Paused'])

    await click(container.querySelector('[aria-label="Actions for Other"]'))
    await settled()
    await press(byText(document.body, 'Delete website', '[role="menuitem"]'))
    await settled()
    await fill(byLabel(document.body, 'Type other.org to confirm'), 'other.org')
    await fill(byLabel(document.body, 'Admin password'), 'secret')
    await submit(document.querySelector('[role="dialog"] form'))
    await settled()
    expect(texts(container, '.analytik-site-name strong')).toEqual(['Example'])
  })
})

describe('update notice', () => {
  it('offers a newer release once, until it is dismissed for good', async () => {
    const api = fakeApi()
    api.state.version = { current: '1.1.0', latest: '1.2.0' }
    const { container } = await open(api)
    const notice = () => container.querySelector('.analytik-update')
    expect(notice()?.textContent).toContain('Analytik 1.2.0 is available.')
    expect(notice()?.textContent).toContain('You are running 1.1.0.')
    expect([...container.querySelectorAll<HTMLAnchorElement>('.analytik-update a')].map((a) => a.href)).toEqual([
      'https://github.com/jantursky/analytik/releases/tag/1.2.0',
      'https://analytik-docs.vercel.app/deploy/backups-retention-and-upgrades#updating',
    ])
    await click(container.querySelector('.analytik-update button'))
    expect(notice()).toBeNull()
    await actAsync(() => new Promise((resolve) => setTimeout(resolve, 700)))
    expect(api.find('PUT', '/preferences').at(-1)?.body).toEqual({ updateDismissed: '1.2.0' })
  })

  it('remembers which release was dismissed, and shows the next one again', async () => {
    const dismissed = fakeApi()
    dismissed.state.version = { current: '1.1.0', latest: '1.2.0' }
    dismissed.state.preferences = { updateDismissed: '1.2.0' }
    expect((await open(dismissed)).container.querySelector('.analytik-update')).toBeNull()
    const next = fakeApi()
    next.state.version = { current: '1.1.0', latest: '1.3.0' }
    next.state.preferences = { updateDismissed: '1.2.0' }
    expect((await open(next)).container.querySelector('.analytik-update')?.textContent).toContain('1.3.0')
  })

  it('stays away when up to date, ahead, or when the lookup found nothing', async () => {
    for (const version of [
      { current: '1.2.0', latest: '1.2.0' },
      { current: '1.3.0', latest: '1.2.0' },
      { current: '1.1.0', latest: null },
    ]) {
      const api = fakeApi()
      api.state.version = version
      expect((await open(api)).container.querySelector('.analytik-update')).toBeNull()
    }
  })
})

describe('formatting and credits', () => {
  it('saves the theme, which the dashboard root then carries', async () => {
    const { container, api } = await open(fakeApi(), 'settings')
    expect(container.querySelector('.analytik')?.getAttribute('data-theme')).toBeNull()
    await section(container, 'Appearance')
    await choose(selectTrigger(container, 'Theme'), 'Dark')
    expect(container.querySelector('.analytik')?.getAttribute('data-theme')).toBe('dark')
    await actAsync(() => new Promise((resolve) => setTimeout(resolve, 700)))
    expect(api.find('PUT', '/preferences').at(-1)?.body).toEqual({ theme: 'dark' })
    await choose(selectTrigger(container, 'Theme'), 'Same as the page')
    expect(container.querySelector('.analytik')?.getAttribute('data-theme')).toBeNull()
  })

  it('saves number and date formats and shows each option written its way', async () => {
    const { container, api } = await open(fakeApi(), 'settings')
    await section(container, 'Formatting')
    await click(selectTrigger(container, 'Numbers'))
    await settled()
    const descriptions = [...document.querySelectorAll('[role="option"] .analytik-menu-description')].map((d) =>
      d.textContent.replace(/\s/g, ' '),
    )
    expect(descriptions).toEqual(['1,234,567 · 5.3%', '1.234.567 · 5,3 %', '1 234 567 · 5,3 %', "1'234'567 · 5.3%"])
    await key(document.activeElement ?? document.body, 'Escape')
    await settled()
    await choose(selectTrigger(container, 'Numbers'), 'Dot groups, comma decimals')
    await choose(selectTrigger(container, 'Dates'), 'ISO 8601')
    expect(api.state.preferences).toEqual({})
    await actAsync(() => new Promise((resolve) => setTimeout(resolve, 700)))
    expect(api.find('PUT', '/preferences').at(-1)?.body).toEqual({
      format: { numbers: 'dot', currency: 'symbol', cents: 'always', date: 'iso', time: '12h' },
    })
    const preview = [...container.querySelectorAll('.analytik-format-preview > span')].map((el) => el.textContent)
    expect(preview[0]?.replace(/\s/g, ' ')).toBe('Payment1.234.567,89 €')
    expect(preview[1]).toMatch(/^Date and time\d{4}-\d{2}-\d{2} /)
    await click(nav(container, 'Overview'))
    await settled()
    // The rest of the dashboard follows: the summary's visitors were "1,200".
    expect(container.querySelector('.analytik-stat-value')?.textContent).toContain('1.200')
    await key(document.body, 'Escape')
    const { setFormatSettings, DEFAULT_FORMAT } = await import('../src/dashboard/format')
    setFormatSettings(DEFAULT_FORMAT)
  })

  it('marks the debug section apart with an icon', async () => {
    const api = fakeApi()
    api.state.debug = true
    const { container } = await open(api, 'settings')
    expect(container.querySelectorAll('.analytik-settings-nav .analytik-icon')).toHaveLength(9)
    expect(container.querySelector('.analytik-settings-nav li[data-tone="debug"]')?.textContent).toBe('Debug')
  })

  it('credits the library and its author under the dashboard, unless turned off', async () => {
    const { container } = await open()
    const links = [...container.querySelectorAll<HTMLAnchorElement>('.analytik-credits a')]
    expect(links.map((a) => [a.textContent.trim(), a.href])).toEqual([
      ['Star on GitHub', 'https://github.com/jantursky/analytik'],
      ['Jan Tursky', 'https://jantursky.com/'],
    ])
    expect(links.every((a) => a.target === '_blank' && a.rel === 'noopener')).toBe(true)
    const bare = await render(<Dashboard api="/api" fetcher={fakeApi().fetcher} credits={false} />)
    await settled()
    expect(bare.container.querySelector('.analytik-credits')).toBeNull()
  })
})

describe('parts', () => {
  it('render on their own inside DashboardProvider', async () => {
    const api = fakeApi()
    const client = createApiClient('/api', api.fetcher)
    const range = presetRange('30d', Date.now())
    const { container } = await render(
      <DashboardProvider client={client} apiUrl="https://stats.example.net/api" site={site} range={range}>
        <SnippetGenerator />
        <Overview />
      </DashboardProvider>,
    )
    await settled()
    expect(container.querySelector('[aria-label="Snippet"]')?.textContent).toContain(
      'src="https://stats.example.net/analytik.js"',
    )
    expect(texts(container, '.analytik-stat-label')).toHaveLength(7)
    expect(byText(container, 'Open live map', 'button')).toBeUndefined()
    await click(byText(container, 'Organic Search', '.analytik-bar-label')?.closest('button'))
  })

  it('throw a helpful error outside a provider', async () => {
    function Probe() {
      useDashboard()
      return null
    }
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(render(<Probe />)).rejects.toThrow('inside <Dashboard> or <DashboardProvider>')
    error.mockRestore()
  })
})
