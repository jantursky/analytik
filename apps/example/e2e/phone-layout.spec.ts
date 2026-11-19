import { expect, test, type Page } from '@playwright/test'

import { VIEWS } from './helpers'

// The page must never scroll sideways on a phone or a small tablet (see playwright.config.ts for the profiles).
// Regions built to scroll inside their own box (tab strip, toolbar, wide tables) are allowed to be wider than the screen.
// Content that is only cut off (`overflow: hidden` or `clip`) is not: it is unreachable on a phone, so it counts.
// The one cut-off that is meant is a label shortened with an ellipsis; its text is the same in the tooltip and the export.
const WIDTHS = [320, 390, 768]

interface Overflow {
  scrollWidth: number
  innerWidth: number
  elements: string[]
}

/** The document's width against the viewport, and the first elements that reach past the right edge outside a scroller. */
const overflow = (page: Page): Promise<Overflow> =>
  page.evaluate(() => {
    const innerWidth = window.innerWidth
    const scrolls = (el: Element): boolean => {
      const style = getComputedStyle(el)
      return (
        /(auto|scroll)/.test(style.overflowX) || (style.overflowX === 'hidden' && style.textOverflow === 'ellipsis')
      )
    }
    const inScroller = (el: Element): boolean => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) if (scrolls(p)) return true
      return false
    }
    const elements: string[] = []
    for (const el of document.querySelectorAll('body *')) {
      const box = el.getBoundingClientRect()
      if (box.width === 0 || box.right <= innerWidth + 1 || inScroller(el)) continue
      if (getComputedStyle(el).position === 'fixed' || el.closest('svg, .analytik-sr-only')) continue
      elements.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} right=${Math.round(box.right)}`)
      if (elements.length === 5) break
    }
    return { scrollWidth: document.documentElement.scrollWidth, innerWidth, elements }
  })

test.use({ reducedMotion: 'reduce' })

for (const width of WIDTHS) {
  for (const view of VIEWS) {
    test(`${view.replace('&tab=', ', ')} fits ${width}px without a sideways page scroll`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      await page.goto(`/?section=${view}#full`)
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeAttached()
      await expect(page.locator('.analytik-skeleton, .analytik-chart-skeleton, [aria-busy="true"]')).toHaveCount(0)
      const found = await overflow(page)
      // On failure the message names the first elements that stick out, not only the widths.
      expect(found.scrollWidth, JSON.stringify(found.elements)).toBeLessThanOrEqual(found.innerWidth)
      expect(found.elements).toEqual([])
    })
  }
}
