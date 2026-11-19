import { expect, test, type Page } from '@playwright/test'

import { VIEWS } from './helpers'

// The page must never scroll sideways on a phone or a small tablet (see playwright.config.ts for the profiles).
// Regions built to scroll inside their own box (tab strip, toolbar, wide tables) are allowed to be wider than the screen.
// Content that is only cut off (`overflow: hidden` or `clip`) is not: it is unreachable on a phone, so it counts.
// The one cut-off that is meant is a label shortened with an ellipsis; its text is the same in the tooltip and the export.
const WIDTHS = [320, 390, 768, 1024]

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

// What the phone layout does beyond fitting: it shows where it scrolls, fills its grid, keeps a table's names in view
// and stays clear of a display cutout.

const open = async (page: Page, view: string): Promise<void> => {
  await page.goto(`/?section=${view}#full`)
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeAttached()
  await expect(page.locator('.analytik-skeleton, .analytik-chart-skeleton, [aria-busy="true"]')).toHaveCount(0)
}

test('the toolbar shows that it scrolls on a phone and says nothing when it fits', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await open(page, 'overview')
  const toolbar = page.locator('.analytik-main > .analytik-toolbar')
  await expect(toolbar).toHaveAttribute('data-edge-end', 'true')
  await expect(toolbar).not.toHaveAttribute('data-edge-start', 'true')
  expect(await toolbar.evaluate((el) => getComputedStyle(el).maskImage)).toContain('linear-gradient')

  await toolbar.evaluate((el) => el.scrollTo({ left: el.scrollWidth }))
  await expect(toolbar).toHaveAttribute('data-edge-start', 'true')
  await expect(toolbar).not.toHaveAttribute('data-edge-end', 'true')

  await page.setViewportSize({ width: 1024, height: 800 })
  await expect(toolbar).not.toHaveAttribute('data-edge-start', 'true')
  await expect(toolbar).not.toHaveAttribute('data-edge-end', 'true')
})

test('an odd last summary cell takes the whole row', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await open(page, 'overview')
  const box = await page.locator('.analytik-overview .analytik-stats').evaluate((el) => ({
    cells: el.children.length,
    width: el.getBoundingClientRect().width,
    last: el.lastElementChild?.getBoundingClientRect().width ?? 0,
    first: el.firstElementChild?.getBoundingClientRect().width ?? 0,
  }))
  expect(box.cells % 2, 'the demo shows an odd number of cells').toBe(1)
  expect(Math.round(box.last)).toBe(Math.round(box.width))
  expect(box.first).toBeLessThan(box.width / 2 + 1)
})

test('a table wider than the screen scrolls inside its card and keeps its first column in place', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await open(page, 'sessions')
  const wrap = page.locator('.analytik-table-wrap').first()
  const first = page.locator('.analytik-table tbody td:first-child').first()
  await expect(wrap).toBeVisible()
  const before = await first.boundingBox()
  expect(await wrap.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  await wrap.evaluate((el) => el.scrollTo({ left: 200 }))
  await expect.poll(async () => (await first.boundingBox())?.x).toBe(before?.x)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('the header, toolbar and page keep clear of a display cutout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await open(page, 'overview')
  // Playwright cannot give a page a cutout, so check that the rules which read it are there, and that the demo asks
  // for the full screen they need.
  expect(await page.locator('meta[name="viewport"]').getAttribute('content')).toContain('viewport-fit=cover')
  const rules = await page.evaluate(() => {
    const found = new Set<string>()
    const walk = (list: CSSRuleList): void => {
      for (const rule of list) {
        if ('cssRules' in rule && (rule as CSSGroupingRule).cssRules.length) walk((rule as CSSGroupingRule).cssRules)
        if (rule instanceof CSSStyleRule && rule.cssText.includes('safe-area-inset-')) found.add(rule.selectorText)
      }
    }
    for (const sheet of document.styleSheets) walk(sheet.cssRules)
    return [...found]
  })
  for (const selector of ['.analytik-header', '.analytik-main']) {
    expect(
      rules.some((rule) => rule.includes(selector)),
      selector,
    ).toBe(true)
  }
})
