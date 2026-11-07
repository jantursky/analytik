import { afterEach, describe, expect, it, vi } from 'vitest'

import { NavScroll } from '../src/dashboard/nav-scroll'
import { actAsync, click, render, settled } from './react-render'

// happy-dom has no layout: give the list a width of 300 inside a 1000 wide strip.
const widths = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get')
const scrolls = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get')

afterEach(() => {
  widths.mockReset()
  scrolls.mockReset()
})

const list = (
  <NavScroll label="Dashboard" active="a">
    <ul>
      <li>
        <button type="button" aria-current="page">
          a
        </button>
      </li>
    </ul>
  </NavScroll>
)

const on = (container: Element, selector: string) => container.querySelector(selector)?.hasAttribute('data-on')

describe('NavScroll', () => {
  it('shows a fade and an arrow only on the side that hides more', async () => {
    widths.mockReturnValue(300)
    scrolls.mockReturnValue(1000)
    const { container } = await render(list)
    await settled()
    expect(on(container, '.analytik-nav-fade[data-side="start"]')).toBe(false)
    expect(on(container, '.analytik-nav-fade[data-side="end"]')).toBe(true)
    expect(on(container, '.analytik-nav-arrow[data-side="end"]')).toBe(true)

    const nav = container.querySelector('nav')
    if (!nav) throw new Error('no nav')
    await actAsync(() => {
      nav.scrollLeft = 700
      nav.dispatchEvent(new Event('scroll'))
    })
    expect(on(container, '.analytik-nav-arrow[data-side="start"]')).toBe(true)
    expect(on(container, '.analytik-nav-arrow[data-side="end"]')).toBe(false)
  })

  it('shows nothing when every view fits, and keeps the arrows away from assistive tech', async () => {
    widths.mockReturnValue(300)
    scrolls.mockReturnValue(300)
    const { container } = await render(list)
    await settled()
    expect(container.querySelectorAll('[data-on]')).toHaveLength(0)
    for (const arrow of container.querySelectorAll('.analytik-nav-arrow')) {
      expect(arrow.getAttribute('aria-hidden')).toBe('true')
      expect(arrow.getAttribute('tabindex')).toBe('-1')
    }
  })

  it('moves the list by most of a page when an arrow is pressed', async () => {
    widths.mockReturnValue(300)
    scrolls.mockReturnValue(1000)
    const { container } = await render(list)
    await settled()
    const nav = container.querySelector('nav')
    if (!nav) throw new Error('no nav')
    const by = vi.fn()
    nav.scrollBy = by
    await click(container.querySelector('.analytik-nav-arrow[data-side="end"]'))
    expect(by).toHaveBeenCalledWith(expect.objectContaining({ left: 210 }))
  })
})
