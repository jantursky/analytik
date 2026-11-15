import { afterEach, describe, expect, it, vi } from 'vitest'

import { Dashboard } from '../src/dashboard/index'
import { setLanguage } from '../src/dashboard/i18n'
import { fakeApi } from './dashboard-fixtures'
import { waitFor } from './dashboard-helpers'
import { actAsync, byText, click, render, settled } from './react-render'

afterEach(() => {
  localStorage.clear()
  vi.useRealTimers()
  setLanguage('en', {})
  history.replaceState(null, '', '/')
})

const status = (container: Element): string =>
  container.querySelector('.analytik-sr-only[role="status"]')?.textContent.trim() ?? ''

async function open(locale?: string) {
  const api = fakeApi()
  const result = await render(<Dashboard api="/api" fetcher={api.fetcher} locale={locale} />)
  await settled()
  return { ...result, api }
}

async function pick(container: Element, preset: string): Promise<void> {
  await click(container.querySelector('.analytik-range-trigger'))
  await settled()
  await click(byText(container, preset, '.analytik-preset'))
  await settled()
}

describe('view change announcements', () => {
  it('says nothing on the first load and has one polite live region', async () => {
    const { container } = await open()
    expect(status(container)).toBe('')
    const region = container.querySelector('.analytik-sr-only[role="status"]')
    expect(region?.getAttribute('aria-live')).toBe('polite')
    expect(container.querySelectorAll('.analytik-sr-only[role="status"]').length).toBe(1)
  })

  it('announces the range after it changes', async () => {
    const { container } = await open()
    await pick(container, 'Past 30 days')
    await waitFor(() => status(container) || null, 200)
    expect(status(container)).toBe('Updated Overview: Past 30 days')
  })

  it('makes one announcement for several quick changes, for the last one', async () => {
    const { container } = await open()
    await pick(container, 'Past 30 days')
    await pick(container, 'Past 90 days')
    await pick(container, 'Past 24 hours')
    await waitFor(() => status(container) || null, 200)
    expect(status(container)).toBe('Updated Overview: Past 24 hours')
  })

  it('counts the filters', async () => {
    const { container } = await open()
    await waitFor(() => container.querySelector('button.analytik-bar'))
    await click(container.querySelector('button.analytik-bar'))
    await waitFor(() => status(container) || null, 200)
    expect(status(container)).toMatch(/^Updated Overview: Past 7 days, 1 filter$/)
  })

  it('stays quiet for a refresh that changes nothing', async () => {
    const { container } = await open()
    // Fake timers: with the debounce run out, a refresh that renews the range's dates but not what it is says nothing.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await click(container.querySelector('[aria-label="Refresh"]'))
    await actAsync(() => vi.advanceTimersByTime(5000))
    expect(status(container)).toBe('')
  })

  it('announces in the dashboard language', async () => {
    const { container } = await open('sk')
    await waitFor(() => byText(container, 'Prehľad', '.analytik-nav-item'))
    await pick(container, 'Posledných 30 dní')
    await waitFor(() => status(container) || null, 200)
    expect(status(container)).toMatch(/^Aktualizované Prehľad: /)
  })
})

describe('focus on a view change', () => {
  it('stays on the navigation item and the heading follows the view', async () => {
    const { container } = await open()
    const item = byText(container, 'Pages', '.analytik-nav-item')!
    item.focus()
    await click(item)
    await settled()
    expect(document.activeElement).toBe(item)
    expect(container.querySelector('.analytik-toolbar h1')?.textContent).toBe('Pages')
  })
})
