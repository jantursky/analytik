import { afterEach, describe, expect, it, vi } from 'vitest'

import { Dashboard } from '../src/dashboard/index'
import { fakeApi } from './dashboard-fixtures'
import { waitFor } from './dashboard-helpers'
import { byText, click, render, settled } from './react-render'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

async function openSettings(top: number) {
  const scroll = vi.fn()
  Element.prototype.scrollIntoView = scroll
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ top }) as DOMRect)
  const api = fakeApi()
  const { container } = await render(<Dashboard api="/api" fetcher={api.fetcher} siteId="site_1" view="settings" />)
  await settled()
  await waitFor(() => container.querySelector('.analytik-settings-nav'))
  return { container, scroll }
}

describe('switching Settings sections', () => {
  it('scrolls back to the top of the section when the page was scrolled down', async () => {
    const { container, scroll } = await openSettings(-300)
    expect(scroll).not.toHaveBeenCalled()
    await click(byText(container, 'Privacy', '.analytik-settings-nav .analytik-nav-item'))
    await waitFor(() => scroll.mock.calls.length > 0)
    expect(scroll).toHaveBeenCalledWith({ block: 'start' })
  })

  it('leaves the page alone when the section is already in view', async () => {
    const { container, scroll } = await openSettings(40)
    await click(byText(container, 'Privacy', '.analytik-settings-nav .analytik-nav-item'))
    await settled()
    expect(scroll).not.toHaveBeenCalled()
  })

  it('lists the sections in the same fading, arrowed scroller as the views', async () => {
    const { container } = await openSettings(40)
    const nav = container.querySelector('.analytik-settings-nav')
    expect(nav?.classList.contains('analytik-nav-wrap')).toBe(true)
    expect(nav?.querySelector('nav[aria-label="Settings"] ul')).not.toBeNull()
    expect(nav?.querySelectorAll('.analytik-nav-arrow')).toHaveLength(2)
  })
})
