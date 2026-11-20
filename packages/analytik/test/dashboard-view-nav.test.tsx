import { afterEach, describe, expect, it } from 'vitest'

import { Dashboard, type DashboardView } from '../src/dashboard/index'
import { fakeApi } from './dashboard-fixtures'
import { choose, press, selectTrigger, switchFor, waitFor } from './dashboard-helpers'
import { actAsync, byText, click, render, settled } from './react-render'

const TOKEN = 'good-token-1234567890abcdef'

async function open(api = fakeApi(), props: { view?: DashboardView; urlState?: boolean; share?: string } = {}) {
  const result = await render(<Dashboard api="/api" fetcher={api.fetcher} siteId="site_1" {...props} />)
  await settled()
  return { ...result, api }
}

const navItems = (container: Element) =>
  [...container.querySelectorAll('.analytik-nav-item')].map((el) => el.textContent.trim())
const title = (container: Element) => container.querySelector('.analytik-toolbar h1')?.textContent
const keyDown = (target: Element | null | undefined, name: string) =>
  actAsync(() => {
    target?.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }))
  })

afterEach(() => {
  history.replaceState(null, '', '/')
  localStorage.clear()
})

describe('the chosen views', () => {
  it('lists every view in the default order when nothing is chosen', async () => {
    const { container } = await open()
    expect(navItems(container)).toEqual([
      'All sites',
      'Overview',
      'Acquisition',
      'Pages',
      'Events',
      'Bots',
      'Funnels',
      'Journeys',
      'Retention',
      'Revenue',
      'Sessions',
      'Live',
      'Settings',
    ])
  })

  it('shows the chosen views in the chosen order, with All sites and Settings kept', async () => {
    const api = fakeApi()
    api.state.preferences = { views: ['sessions', 'overview', 'pages'] }
    const { container } = await open(api)
    expect(navItems(container)).toEqual(['All sites', 'Sessions', 'Overview', 'Pages', 'Settings'])
  })

  it('keeps a hidden view in the list while an address has it open', async () => {
    history.replaceState(null, '', '/?site=site_1&section=bots')
    try {
      const api = fakeApi()
      api.state.preferences = { views: ['overview', 'pages'] }
      const { container } = await open(api, { urlState: true })
      expect(title(container)).toBe('Bots')
      expect(navItems(container)).toEqual(['All sites', 'Overview', 'Pages', 'Bots', 'Settings'])
    } finally {
      history.replaceState(null, '', '/')
    }
  })

  it('does not follow a go-to shortcut to a hidden view', async () => {
    const api = fakeApi()
    api.state.preferences = { views: ['overview', 'pages'] }
    const { container } = await open(api, { view: 'overview' })
    await keyDown(container.querySelector('.analytik-nav-item'), 'g')
    await keyDown(container.querySelector('.analytik-nav-item'), 'e')
    expect(title(container)).toBe('Overview')
    await keyDown(container.querySelector('.analytik-nav-item'), 'g')
    await keyDown(container.querySelector('.analytik-nav-item'), 'p')
    expect(title(container)).toBe('Pages')
  })

  it('gives a share link its own list whatever the admin chose', async () => {
    const api = fakeApi()
    api.state.preferences = { views: ['sessions'] }
    const { container } = await open(api, { share: TOKEN })
    expect(navItems(container)).toContain('Events')
    expect(navItems(container)).toContain('Overview')
  })
})

describe('the start page', () => {
  it('opens the saved start view for a bare address', async () => {
    const api = fakeApi()
    api.state.preferences = { startView: 'sessions' }
    const { container } = await open(api)
    expect(title(container)).toBe('Sessions')
  })

  it('lets the view prop and the address win over it', async () => {
    const api = fakeApi()
    api.state.preferences = { startView: 'sessions' }
    expect(title((await open(api, { view: 'events' })).container)).toBe('Events')
  })

  it('opens the first visible view when the start view is hidden', async () => {
    const api = fakeApi()
    api.state.preferences = { views: ['pages', 'events'], startView: 'sessions' }
    const { container } = await open(api)
    expect(title(container)).toBe('Pages')
  })

  it('stays where the user went once they have chosen a view', async () => {
    const api = fakeApi()
    api.state.preferences = { startView: 'sessions' }
    const { container } = await open(api)
    const pages = [...container.querySelectorAll<HTMLElement>('.analytik-nav-item')].find(
      (el) => el.textContent.trim() === 'Pages',
    )
    await actAsync(() => pages?.click())
    expect(title(container)).toBe('Pages')
  })
})

describe('the Views card in Settings', () => {
  const openCard = async (preferences: Record<string, unknown> = {}) => {
    const api = fakeApi()
    api.state.preferences = preferences
    const result = await open(api, { view: 'settings' })
    await click(byText(result.container, 'Appearance', '.analytik-settings-nav button'))
    await settled()
    return { ...result, api }
  }
  const rows = (container: Element) =>
    [...container.querySelectorAll('.analytik-view-row')].map((row) =>
      row.querySelector('.analytik-switch-field')?.textContent.trim(),
    )
  const button = (container: Element, label: string) =>
    container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  const saved = (api: ReturnType<typeof fakeApi>, match: (body: Record<string, unknown>) => boolean) =>
    waitFor(() => api.find('PUT', '/preferences').some((r) => match(r.body as Record<string, unknown>)) || null, 400)

  it('lists the views, shown ones first in their order and hidden ones below', async () => {
    const { container } = await openCard({ views: ['sessions', 'overview'] })
    expect(rows(container).slice(0, 2)).toEqual(['Sessions', 'Overview'])
    expect(rows(container)).toHaveLength(11)
    expect(container.querySelectorAll('.analytik-view-row[data-hidden]')).toHaveLength(9)
  })

  it('hides and shows a view, and updates the navigation at once', async () => {
    const { container, api } = await openCard()
    await press(switchFor(container, 'Bots'))
    expect(navItems(container)).not.toContain('Bots')
    await saved(api, (b) => Array.isArray(b.views) && !(b.views as string[]).includes('bots'))
    await press(switchFor(container, 'Bots'))
    expect(navItems(container)).toContain('Bots')
  })

  it('moves a view with the buttons, announces the place and keeps the focus on the button', async () => {
    const { container, api } = await openCard()
    const earlier = button(container, 'Move Sessions earlier')
    earlier?.focus()
    await press(earlier)
    expect(rows(container).slice(8, 11)).toEqual(['Sessions', 'Revenue', 'Live'])
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Sessions is now number 9 of 11')
    expect(document.activeElement).toBe(button(container, 'Move Sessions earlier'))
    await saved(api, (b) => Array.isArray(b.views))
  })

  it('cannot hide the last view', async () => {
    const { container } = await openCard({ views: ['pages'] })
    expect(switchFor(container, 'Pages')?.hasAttribute('disabled')).toBe(true)
  })

  it('resets the order, visibility and start page', async () => {
    const { container, api } = await openCard({ views: ['pages'], startView: 'pages' })
    await press(byText(container, 'Reset', '.analytik-card button'))
    expect(rows(container)[0]).toBe('Overview')
    await saved(api, (b) => b.views === undefined && b.startView === undefined)
  })

  it('offers only visible views as the start page and saves the choice', async () => {
    const { container, api } = await openCard({ views: ['pages', 'sessions'] })
    await choose(selectTrigger(container, 'Start page'), 'Sessions')
    await saved(api, (b) => b.startView === 'sessions')
  })
})
