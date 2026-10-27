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
import { fakeApi, realtime, row, site } from './dashboard-fixtures'
import { choose, comboboxInput, press, selectTrigger, switchFor, type, waitFor } from './dashboard-helpers'
import { actAsync, byLabel, byText, click, fill, key, render, settled, submit } from './react-render'

async function open(api = fakeApi(), view?: DashboardView, extra: { siteId?: string; theme?: 'dark' } = {}) {
  const result = await render(<Dashboard api="/api" fetcher={api.fetcher} view={view} {...extra} />)
  await settled()
  return { ...result, api }
}

const nav = (container: HTMLElement, label: string) => byText(container, label, '.analytik-nav-item')
const texts = (container: Element, selector: string) =>
  [...container.querySelectorAll(selector)].map((el) => el.textContent.trim())

afterEach(() => {
  vi.useRealTimers()
})

describe('Dashboard shell', () => {
  it('shows the login form on 401 and loads the sites after signing in', async () => {
    const api = fakeApi()
    api.state.loggedIn = false
    const { container } = await open(api)
    const form = container.querySelector('form')
    expect(container.querySelector('h1')?.textContent).toBe('Sign in to analytik')
    await fill(byLabel(container, 'Admin password'), 'nope')
    await submit(form)
    await settled()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Wrong password')
    await fill(byLabel(container, 'Admin password'), 'secret')
    await submit(form)
    await settled()
    expect(container.querySelector('.analytik-toolbar h1')?.textContent).toBe('Overview')
    expect(selectTrigger(container, 'Site')?.textContent).toBe('EExample')
  })

  it('signs out', async () => {
    const { container, api } = await open()
    await click(byText(container, 'Log out', 'button'))
    await settled()
    expect(api.find('POST', '/auth/logout')).toHaveLength(1)
    expect(container.querySelector('h1')?.textContent).toBe('Sign in to analytik')
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
      'Session time',
      'Online',
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
      texts(container, '.analytik-stat .analytik-badge').map((t) => t.replace('Change from previous period: ', '')),
    ).toEqual(['+20%', 'new', '+8%', '+20%', '+5%', '-8%'])
    expect(container.querySelector('.analytik-stat:nth-child(5) .analytik-badge')?.getAttribute('data-trend')).toBe(
      'down',
    )
    expect(container.querySelectorAll('.analytik-stat .analytik-marker')).toHaveLength(2)
    expect(container.querySelector('figcaption')?.textContent).toMatch(/^Visitors, 4 points, peak 600 at /)
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

    await click(byText(container, 'View on map', 'button'))
    await settled()
    expect(nav(container, 'Realtime')?.getAttribute('aria-current')).toBe('page')
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
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Keyword')
    await key(document.activeElement, 'ArrowRight')
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Channel')
    await key(document.activeElement, 'x')
  })

  it('changes the date range with presets and a range picked on the calendar', async () => {
    const { container, api } = await open()
    const trigger = () => container.querySelector('.analytik-range-trigger')
    await click(trigger())
    await settled()
    expect(byText(container, 'Last 7 days', '.analytik-preset')?.getAttribute('aria-pressed')).toBe('true')
    await click(byText(container, 'Last 12 months', '.analytik-preset'))
    await settled()
    expect(api.find('GET', '/sites/site_1/overview').at(-1)?.params.interval).toBe('month')
    expect(trigger()?.textContent).toBe('Last 12 months')

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
    expect(texts(document.body, '[role="option"]')).toEqual(['Hourly', 'Daily'])
    await click(selectTrigger(container, 'Interval'))
    await choose(selectTrigger(container, 'Interval'), 'Hourly')
    expect(last()?.interval).toBe('hour')

    const before = api.find('GET', '/sites/site_1/overview').length
    await click(container.querySelector('[aria-label="Refresh"]'))
    await settled()
    expect(api.find('GET', '/sites/site_1/overview').length).toBe(before + 1)

    await click(container.querySelector('.analytik-range-trigger'))
    await settled()
    await click(byText(container, 'Last 30 days', '.analytik-preset'))
    await settled()
    const count = api.find('GET', '/sites/site_1/overview').length
    await click(container.querySelector('[aria-label="Refresh"]'))
    await settled()
    expect(api.find('GET', '/sites/site_1/overview').length).toBe(count + 1)
    expect(last()?.interval).toBe('day')
  })

  it('refreshes live while the page is visible', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const { container, api } = await open()
    const live = switchFor(container, 'Live')
    expect(live?.getAttribute('aria-checked')).toBe('false')
    await click(live)
    expect(live?.getAttribute('aria-checked')).toBe('true')
    const before = api.find('GET', '/sites/site_1/overview').length
    await actAsync(() => vi.advanceTimersByTime(30000))
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
    expect(comboboxInput(container, 'Timezone')?.value).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
    await fill(byLabel(container, 'Name'), 'New')
    await fill(byLabel(container, 'Domain'), 'https://New.example.org/path?x')
    await choose(selectTrigger(container, 'Revenue currency'), 'EUR')
    await type(comboboxInput(container, 'Timezone'), 'Europe/Ber')
    await press(byText(document.body, 'Europe/Berlin', '[role="option"]'))
    await settled()
    expect(submitButton?.disabled).toBe(false)
    await submit(dialog()?.querySelector('form'))
    await settled()
    expect(api.find('POST', '/sites')[0]?.body).toMatchObject({
      name: 'New',
      domain: 'new.example.org',
      currency: 'EUR',
      timezone: 'Europe/Berlin',
    })
    expect(dialog()).toBeNull()
    expect(container.querySelector('.analytik-toolbar h1')?.textContent).toBe('Settings')
  })

  it('lists every site with its last 24 hours and opens one', async () => {
    const { container, api } = await open(fakeApi(), 'sites')
    expect(container.querySelector('h1')?.textContent).toBe('Websites')
    const cards = [...container.querySelectorAll('.analytik-site-card')]
    expect(cards.map((c) => c.textContent)).toEqual([
      'EExampleexample.com1,200visitors in the last 24h4 online',
      'OOtherother.org1,200visitors in the last 24h4 online',
    ])
    const calls = api.find('GET', '/sites/site_2/overview')
    expect(calls).toHaveLength(1)
    expect(Date.parse(calls[0]?.params.to ?? '') - Date.parse(calls[0]?.params.from ?? '')).toBe(86400000)
    expect(calls[0]?.params.interval).toBe('hour')
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

  it('shows a dash and an idle dot when a site card fails to load', async () => {
    const { container } = await open(
      fakeApi({ 'GET /sites/:id/overview': () => Response.json({ error: 'nope' }, { status: 500 }) }),
      'sites',
    )
    expect(texts(container, '.analytik-site-number')).toEqual(['–', '–'])
    expect(container.querySelectorAll('.analytik-site-card .analytik-live-dot[data-idle]')).toHaveLength(2)
  })

  it('asks for a first site and shows creation errors', async () => {
    const api = fakeApi({ 'POST /sites': () => Response.json({ error: 'Domain taken' }, { status: 409 }) })
    api.state.sites = []
    const { container } = await open(api)
    expect(container.querySelector('h1')?.textContent).toBe('Add a website')
    expect(byText(container, 'Subdomains (app.example.com) are tracked under the same site.')).toBeDefined()
    await fill(byLabel(container, 'Name'), 'A')
    await fill(byLabel(container, 'Domain'), 'a.org')
    await submit(container.querySelector('form'))
    await settled()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Domain taken')
  })

  it('shows API errors', async () => {
    const { container } = await open(
      fakeApi({ 'GET /sites': () => Response.json({ error: 'Database down' }, { status: 500 }) }),
    )
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Database down')
    const broken = await open(fakeApi({ 'GET /sites/:id/overview': () => new Response('x', { status: 502 }) }))
    expect(broken.container.querySelector('[role="alert"]')?.textContent).toBe('HTTP 502')
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
      'Keyword',
      'Content',
      'Ref',
    ])
    await click(nav(container, 'Pages'))
    await settled()
    expect(texts(container, '[role="tab"]')).toEqual(['Page', 'Entry page', 'Exit page'])
    expect(api.find('GET', '/sites/site_1/breakdown').map((r) => r.params.dimension)).toEqual(['channel', 'page'])
  })

  it('Events lists goals and recent events, filtered by the goal filter', async () => {
    const { container, api } = await open(fakeApi(), 'events')
    expect(texts(container, '[role="tab"]')).toEqual(['Goal', 'Event', 'Exit link'])
    expect(texts(container, 'tbody td')).toEqual(['Oct 26, 2026, 10:00 AM', 'goal', 'signup', '/pricing'])
    await click(byText(container, 'goal-a', '.analytik-bar-label')?.closest('button'))
    await settled()
    expect(api.find('GET', '/sites/site_1/events').at(-1)?.params).toMatchObject({ name: 'goal-a', goal: 'goal-a' })
    expect(byText(container, 'Recent “goal-a” events', 'h2')).toBeDefined()
  })

  it('Revenue shows revenue stats, chart, breakdown by revenue and payments', async () => {
    const { container } = await open(fakeApi(), 'revenue')
    expect(texts(container, '.analytik-stat-label')).toEqual([
      'Revenue',
      'Orders',
      'Conversion rate',
      'Revenue per visitor',
    ])
    expect(texts(container, '.analytik-bars .analytik-bar-label')).toEqual(['Organic Search'])
    expect(texts(container, '.analytik-bars .analytik-bar-value')).toEqual(['€99.00'])
    const rows = [...container.querySelectorAll('.analytik-table tbody tr')].map((tr) => texts(tr, 'td'))
    expect(rows).toEqual([
      ['Oct 26, 2026, 10:05 AM', '€49.90renewal', 'stripe', 'Ann Buyer', 'metadata'],
      ['Oct 26, 2026, 10:05 AM', '-€49.90refund', 'stripe', 'cus_1', 'unattributed'],
    ])
  })

  it('Sessions pages through sessions and opens a visitor timeline', async () => {
    const { container, api } = await open(fakeApi(), 'sessions')
    expect(texts(container, 'tbody tr:first-child td')).toEqual([
      'Oct 26, 2026, 10:00 AM',
      'news.ycombinator.com',
      'Berlin, DE',
      '/pricing',
      '3',
      '2m 5s',
      '€49.90',
    ])
    await click(byText(container, 'Load more', 'button'))
    await settled()
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(api.find('GET', '/sites/site_1/sessions').at(-1)?.params.cursor).toBe('c2')
    expect(byText(container, 'Load more', 'button')).toBeUndefined()
    await click(container.querySelector('tbody .analytik-link'))
    await settled()
    expect(texts(container, '.analytik-timeline li')).toEqual(['+0spageview/pricing', '+42sgoalsignup'])
    expect(container.querySelector('.analytik-muted')?.textContent).toContain('desktop / Firefox / Linux')
    expect(container.querySelector('tbody tr')?.getAttribute('aria-selected')).toBe('true')
    await click(byText(container, 'Close', 'button'))
    expect(container.querySelector('.analytik-timeline')).toBeNull()
  })

  it('Funnels shows conversion per step, creates and deletes funnels', async () => {
    const { container, api } = await open(fakeApi(), 'funnels')
    expect(texts(container, '.analytik-funnel li')).toEqual(['1. /1,000 · 100%', '2. signup250 · 25% · 75% dropped'])
    await fill(byLabel(container, 'Funnel name'), 'Checkout')
    await submit(container.querySelector('form'))
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('A funnel needs at least two steps.')
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
    const remove = byText(container, 'Delete', 'button')
    await click(remove)
    expect(remove?.textContent).toBe('Confirm delete')
    await click(remove)
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
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Invalid step')
  })

  it('Realtime maps who is online, describes what they do and refreshes while visible', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
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
  })

  it('Realtime switches to a globe, a light map and back to the overview', async () => {
    const { container } = await open(fakeApi(), 'realtime')
    const button = (label: string) => container.querySelector(`[aria-label="${label}"]`)
    expect(container.querySelector('.analytik-map > circle')).toBeNull()
    await click(button('Globe view'))
    expect(button('Globe view')?.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('.analytik-map > circle')).not.toBeNull()
    await click(button('Light map'))
    expect(container.querySelector('.analytik-realtime')?.getAttribute('data-map')).toBe('light')
    await click(button('Close real-time view'))
    await settled()
    expect(nav(container, 'Overview')?.getAttribute('aria-current')).toBe('page')
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
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
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

describe('Settings', () => {
  it('saves the site settings', async () => {
    const { container, api } = await open(fakeApi(), 'settings')
    await fill(byLabel(container, 'Name'), 'Renamed')
    await fill(byLabel(container, 'Domain'), ' new.org ')
    await fill(byLabel(container, 'Currency'), 'usd')
    await type(comboboxInput(container, 'Timezone'), 'Europe/Ber')
    await press(byText(document.body, 'Europe/Berlin', '[role="option"]'))
    await fill(byLabel(container, 'Keep data for (days)'), '365')
    await fill(byLabel(container, 'Ignored IP addresses'), '1.2.3.4\n 5.6.7.8 ,')
    await click(container.querySelector('input[value="persistent"]'))
    await click(switchFor(container, 'Accept events from localhost (for testing; turn off once live)'))
    await submit(container.querySelector('form'))
    await settled()
    expect(api.find('PATCH', '/sites/site_1')[0]?.body).toEqual({
      name: 'Renamed',
      domain: 'new.org',
      timezone: 'Europe/Berlin',
      currency: 'USD',
      privacyMode: 'persistent',
      retentionDays: 365,
      allowLocalhost: true,
      ignoredIps: ['1.2.3.4', '5.6.7.8'],
    })
    expect(byText(container, 'Settings saved', '[role="status"]')).toBeDefined()
    await fill(byLabel(container, 'Keep data for (days)'), '')
    await submit(container.querySelector('form'))
    await settled()
    expect((api.find('PATCH', '/sites/site_1')[1]?.body as { retentionDays: unknown }).retentionDays).toBeNull()
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

  it('generates the snippet and copies it', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const { container } = await open(fakeApi(), 'settings')
    const snippet = () => container.querySelector('[aria-label="Snippet"]')?.textContent
    expect(snippet()).toBe(`<script defer src="${location.origin}/analytik.js" data-site="site_1"></script>`)
    await choose(selectTrigger(container, 'Mode'), 'Enriched')
    await fill(byLabel(container, 'Keep query parameters'), 'page')
    await click(switchFor(container, 'Track clicks on outbound links'))
    await click(switchFor(container, 'Wait for an interaction or 3 seconds on screen before counting (filters bots)'))
    expect(snippet()).toBe(
      `<script defer src="${location.origin}/analytik.js" data-site="site_1" data-mode="enriched" data-require-interaction="false" data-auto-outbound="false" data-keep-query="page"></script>`,
    )
    await click(byText(container, 'Copy snippet', 'button'))
    await settled()
    expect(writeText).toHaveBeenCalledWith(snippet())
    expect(byText(container, 'Copied', '[role="status"]')).toBeDefined()
    writeText.mockRejectedValueOnce(new Error('denied'))
    await click(byText(container, 'Copy snippet', 'button'))
    await settled()
    expect(byText(container, 'Copy failed, select the text instead', '[role="status"]')).toBeDefined()
  })

  it('builds campaign links', async () => {
    const { container } = await open(fakeApi(), 'settings')
    expect(byText(container, 'Enter a full page URL and a source.')).toBeDefined()
    await fill(byLabel(container, 'Page URL'), 'https://example.com/pricing')
    await fill(byLabel(container, 'Source (required)'), 'newsletter')
    await fill(byLabel(container, 'Campaign'), 'launch')
    expect(container.querySelector('[aria-label="Campaign link"]')?.textContent).toBe(
      'https://example.com/pricing?utm_source=newsletter&utm_campaign=launch',
    )
  })

  it('rotates the API key, saves webhook secrets and manages data', async () => {
    const { container, api } = await open(fakeApi(), 'settings')
    const rotate = byText(container, 'Rotate key', 'button')
    await click(rotate)
    await click(rotate)
    await settled()
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

    expect([...container.querySelectorAll('a[download]')].map((a) => a.getAttribute('href'))).toEqual([
      '/api/sites/site_1/export?format=json',
      '/api/sites/site_1/export?format=csv',
    ])
    await click(byText(container, 'Re-run payment attribution', 'button'))
    await settled()
    expect(api.find('POST', '/sites/site_1/rematch')).toHaveLength(1)
    await click(container.querySelector('.analytik-date-trigger'))
    await settled()
    expect(container.querySelector('.analytik-calendar')).not.toBeNull()
    const firstDay = container.querySelector<HTMLElement>('.analytik-day:not([data-outside])')!
    const picked = firstDay.dataset.day!
    await click(firstDay)
    await settled()
    expect(container.querySelector('.analytik-calendar')).toBeNull()
    const purge = byText(container, 'Delete', 'button')
    await click(purge)
    expect(purge?.textContent).toBe(`Delete everything before ${picked}?`)
    await actAsync(() => purge?.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
    expect(purge?.textContent).toBe('Delete')
    await click(purge)
    await click(purge)
    await settled()
    expect(api.find('DELETE', '/sites/site_1/data')[0]?.params.before).toBe(
      new Date(`${picked}T00:00:00`).toISOString(),
    )
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
    expect(byText(container, 'View on map', 'button')).toBeUndefined()
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
