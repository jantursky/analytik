import { afterEach, describe, expect, it, vi } from 'vitest'

import { Dashboard, type DashboardView } from '../src/dashboard/index'
import { fakeApi } from './dashboard-fixtures'
import { choose, selectTrigger } from './dashboard-helpers'
import { byText, click, fill, render, settled, submit } from './react-render'

const TOKEN = 'good-token-1234567890abcdef'

async function open(api = fakeApi(), props: { share?: string; view?: DashboardView; siteId?: string } = {}) {
  const result = await render(<Dashboard api="/api" fetcher={api.fetcher} siteId="site_1" {...props} />)
  await settled()
  return { ...result, api }
}

const navItems = (container: Element) =>
  [...container.querySelectorAll('.analytik-nav-item')].map((el) => el.textContent.trim())

afterEach(() => {
  history.replaceState(null, '', '/')
  localStorage.clear()
})

describe('a dashboard opened with a share link', () => {
  it('shows one site read-only, and puts the token on every read', async () => {
    const { container, api } = await open(fakeApi(), { share: TOKEN })
    expect(container.querySelector('.analytik-site-name')?.textContent).toContain('Example')
    expect(navItems(container)).toEqual([
      'Overview',
      'Acquisition',
      'Pages',
      'Events',
      'Bots',
      'Funnels',
      'Sessions',
      'Live',
    ])
    // Nothing that edits: no sign-out, customize, site switcher, settings, add-website or update notice.
    expect(container.querySelector('.analytik-signout')).toBeNull()
    expect(container.querySelector('.analytik-customize')).toBeNull()
    expect(container.querySelector('.analytik-switcher[role="combobox"]')).toBeNull()
    // The site list and the preferences are admin routes: a shared dashboard never asks for them.
    expect(api.requests.some((r) => r.path === '/sites' || r.path === '/preferences' || r.path === '/version')).toBe(
      false,
    )
    const reads = api.requests.filter((r) => r.method === 'GET')
    expect(reads.length).toBeGreaterThan(2)
    expect(reads.every((r) => r.params.share === TOKEN)).toBe(true)
    expect(api.requests.every((r) => r.method === 'GET')).toBe(true)
  })

  it('reads the token and the site from the address', async () => {
    history.replaceState(null, '', `/?site=site_1&share=${TOKEN}&section=pages`)
    const { container, api } = await open(fakeApi(), { siteId: undefined })
    expect(container.querySelector('.analytik-nav-item[aria-current="page"]')?.textContent).toBe('Pages')
    expect(api.find('GET', '/sites/site_1/shared')[0]?.params.share).toBe(TOKEN)
  })

  it('shows only the views the link allows and falls back to the first of them', async () => {
    const api = fakeApi()
    api.state.sharedViews[TOKEN] = ['bots', 'sessions']
    const { container } = await open(api, { share: TOKEN, view: 'settings' })
    expect(navItems(container)).toEqual(['Bots', 'Sessions'])
    expect(container.querySelector('.analytik-nav-item[aria-current="page"]')?.textContent).toBe('Bots')
    expect(container.querySelector('.analytik-settings')).toBeNull()
    await click(byText(container, 'Sessions', '.analytik-nav-item'))
    await settled()
    expect(container.querySelector('.analytik-nav-item[aria-current="page"]')?.textContent).toBe('Sessions')
  })

  it('hides the funnel editor', async () => {
    const { container } = await open(fakeApi(), { share: TOKEN, view: 'funnels' })
    expect(container.querySelector('.analytik-card-title, h2')).not.toBeNull()
    expect(byText(container, 'New funnel')).toBeUndefined()
    expect(byText(container, 'Delete', 'button')).toBeUndefined()
  })

  it('explains a link that no longer works instead of asking for a login', async () => {
    const { container } = await open(fakeApi(), { share: 'revoked-token-1234567890abc' })
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('This share link does not work')
    expect(container.querySelector('input[type="password"]')).toBeNull()
  })

  it('needs the site in the address', async () => {
    const { container } = await open(fakeApi(), { share: TOKEN, siteId: undefined })
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
  })

  it('leaves the admin dashboard alone without a token', async () => {
    const { container, api } = await open(fakeApi())
    expect(container.querySelector('.analytik-signout')).not.toBeNull()
    expect(api.requests.every((r) => r.params.share === undefined)).toBe(true)
  })
})

describe('Settings → Sharing', () => {
  const sharing = async () => {
    const opened = await open(fakeApi(), { view: 'settings' })
    await click(byText(opened.container, 'Sharing', '.analytik-settings-nav button'))
    await settled()
    return opened
  }

  it('creates a link limited to some views, shows it once and lists it', async () => {
    const { container, api } = await sharing()
    expect(container.textContent).toContain('No share links yet.')
    await fill(container.querySelector('.analytik-field input'), 'Board')
    await click(byText(container, 'All views', 'button.analytik-date-trigger'))
    await settled()
    const boxes = [...document.querySelectorAll<HTMLInputElement>('.analytik-multi-list input')]
    expect(boxes).toHaveLength(9)
    await click(boxes[5]) // Sessions
    await click(boxes[6]) // Bots
    await settled()
    expect(byText(document.body, '2 views', 'button.analytik-date-trigger')).toBeDefined()
    await submit(container.querySelector('form'))
    await settled()
    expect(api.find('POST', '/sites/site_1/share-links')[0]?.body).toEqual({
      label: 'Board',
      views: ['sessions', 'bots'],
    })
    const created = container.querySelector<HTMLInputElement>('.analytik-share-created input')
    expect(created?.value).toBe(`${location.origin}/?site=site_1&share=new-token-1234567890abcdefghij`)
    // A shared link is opened in a browser: no Mac app link beside it.
    expect(container.querySelector('.analytik-share-created input[aria-label="Mac app link"]')).toBeNull()
    expect(container.querySelector('.analytik-share-list')?.textContent).toContain('Board')
    expect(container.querySelector('.analytik-share-list')?.textContent).toContain('Sessions, Bots')
    expect(container.querySelector('.analytik-share-list')?.textContent).toContain('Active')
  })

  it('copies the link', async () => {
    const { container } = await sharing()
    await submit(container.querySelector('form'))
    await settled()
    const write = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true })
    await click(byText(container, 'Copy link', 'button'))
    expect(write).toHaveBeenCalledWith(expect.stringContaining('share=new-token-'))
  })

  it('makes a Mac app link with the two views the app reads', async () => {
    const { container, api } = await sharing()
    await choose(selectTrigger(container, 'Link for'), 'Mac menu bar app')
    // The app's views are fixed, so there is nothing to choose.
    expect(byText(container, 'All views', 'button.analytik-date-trigger')).toBeUndefined()
    await submit(container.querySelector('form'))
    await settled()
    expect(api.find('POST', '/sites/site_1/share-links')[0]?.body).toEqual({
      label: '',
      views: ['overview', 'realtime'],
    })
    const mac = container.querySelector<HTMLInputElement>('.analytik-share-created input[aria-label="Mac app link"]')
    const link = new URL(mac?.value ?? '')
    expect(link.protocol).toBe('analytik:')
    expect(link.host).toBe('connect')
    expect(link.searchParams.get('server')).toBe(`${location.origin}/api`)
    expect(link.searchParams.get('site')).toBe('site_1')
    expect(link.searchParams.get('token')).toBe('new-token-1234567890abcdefghij')
    expect(link.searchParams.get('name')).toBe('Example')
    expect(link.searchParams.get('dashboard')).toBe(
      `${location.origin}/?site=site_1&share=new-token-1234567890abcdefghij`,
    )
  })

  it('copies the Mac app link', async () => {
    const { container } = await sharing()
    await choose(selectTrigger(container, 'Link for'), 'Mac menu bar app')
    await submit(container.querySelector('form'))
    await settled()
    const write = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true })
    await click(byText(container, 'Copy Mac app link', 'button'))
    expect(write).toHaveBeenCalledWith(expect.stringMatching(/^analytik:\/\/connect\?server=.*&token=new-token-/))
  })

  it('revokes a link after asking', async () => {
    const api = fakeApi()
    api.state.shareLinks = [
      { id: 'sl_9', siteId: 'site_1', label: 'Old', views: [], createdAt: 1, expiresAt: null, revokedAt: null },
    ]
    const { container } = await render(<Dashboard api="/api" fetcher={api.fetcher} view="settings" />)
    await settled()
    await click(byText(container, 'Sharing', '.analytik-settings-nav button'))
    await settled()
    expect(container.querySelector('.analytik-share-list')?.textContent).toContain('All views')
    await click(byText(container, 'Revoke', '.analytik-share-list button'))
    await settled()
    await click(byText(container, 'Revoke link', '[role="dialog"] button'))
    await settled()
    expect(api.find('DELETE', '/sites/site_1/share-links/sl_9')).toHaveLength(1)
    expect(container.querySelector('.analytik-share-list')?.textContent).toContain('Revoked')
    expect(byText(container, 'Revoke', '.analytik-share-list button')).toBeUndefined()
  })
})
