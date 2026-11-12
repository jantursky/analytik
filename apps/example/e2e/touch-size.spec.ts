import { expect, test, type Page } from '@playwright/test'

// How big a finger's target is, on the Pixel 7 and iPhone 14 profiles (see playwright.config.ts). The size is the
// area that answers a tap, not the drawn box: a control may look small and reach further with a transparent extension,
// so each control is hit-tested at the corners of a centred square of the wanted size instead of being measured.
// WCAG 2.2 asks for 24 px (AA); the primary controls get 44 px, the size phones' guidelines name.
const MINIMUM = 24
const PRIMARY_MINIMUM = 44

/** Controls whose tap area has to reach 44 px: the ones used all the time. */
const PRIMARY = [
  '.analytik-header :is(button, a)',
  '.analytik-nav-item',
  '.analytik-toolbar :is(button, [role="combobox"], [role="switch"], [role="tab"])',
  '.analytik-pill',
  '.analytik-pill-icon',
  '.analytik-cell-action',
  '[role="dialog"] .analytik-button',
  '.analytik-page-head .analytik-button',
]

const CONTROLS =
  'button, a[href], [role="button"], [role="tab"], [role="switch"], [role="combobox"], [role="menuitem"], input:not([type="hidden"]), select, textarea'

// Left out of the check, with the reason. The Journeys bars are as tall as the number of sessions they stand for, so a
// small flow is a few pixels high and a column of them leaves no room for a bigger target without overlapping. What a
// bar does, filtering the dashboard by that page, is also done from the Pages view, which WCAG 2.5.8 accepts as an
// equivalent. This is listed as a known gap in the embedding guide.
const EXEMPT = ['.analytik-journey-node']

const VIEWS = [
  'sites',
  'overview',
  'sources',
  'pages',
  'events',
  'bots',
  'funnels',
  'journeys',
  'retention',
  'revenue',
  'sessions',
  'realtime',
  'settings&tab=general',
  'settings&tab=sharing',
]

interface Small {
  control: string
  size: number
  wanted: number
}

/** The controls on the page whose tap area is smaller than it should be. */
const undersized = (page: Page): Promise<Small[]> =>
  page.evaluate(
    ({ controls, primary, exempt, minimum, primaryMinimum }) => {
      const describe = (el: Element): string => {
        const label = el.getAttribute('aria-label') ?? el.textContent.trim().slice(0, 30)
        return `${el.tagName.toLowerCase()}.${[...el.classList].join('.')} "${label}"`
      }
      const visible = (el: Element): boolean => {
        const box = el.getBoundingClientRect()
        const style = getComputedStyle(el)
        return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
      }
      // The four edge points and the centre of a circle of the wanted size around the control's centre: each must
      // answer to the control, which a transparent extension of it does too. A control already as big as the circle
      // covers it itself.
      const reach = (el: Element, wanted: number): boolean => {
        el.scrollIntoView({ block: 'center', inline: 'center' })
        // A marker in a chart carries a shape that is only there to be tapped; its box, not the whole group's (which
        // takes in a line down the chart or a ripple that grows), says where the finger lands.
        const box = (el.querySelector('[class$="-hit"]') ?? el).getBoundingClientRect()
        const cx = box.left + box.width / 2
        const cy = box.top + box.height / 2
        const half = wanted / 2 - 1
        // Row actions sit in rows 30 to 34 px apart; 44 px tall would reach into the next row's own targets, so they
        // are 44 wide and as tall as the minimum, which the spacing rule of WCAG 2.5.8 allows.
        const halfHeight = el.matches('.analytik-cell-action') ? minimum / 2 - 1 : half
        return [
          [cx, cy],
          [cx - half, cy],
          [cx + half, cy],
          [cx, cy - halfHeight],
          [cx, cy + halfHeight],
        ].every(([x = 0, y = 0]) => {
          const hit = document.elementFromPoint(x, y)
          if (!hit) return false
          if (el === hit || el.contains(hit) || hit.contains(el)) return true
          // Another control answers there (a neighbour's extension, a marker beside it): the area is not dead, and
          // that control is checked on its own. Anything else, the page, the chart or a label, is a missed tap.
          return !!hit.closest(controls)
        })
      }
      const isPrimary = (el: Element): boolean => primary.some((selector) => el.matches(selector))
      const found: { control: string; size: number; wanted: number }[] = []
      for (const el of document.querySelectorAll(controls)) {
        if (!visible(el) || el.closest('[aria-hidden="true"], [inert]')) continue
        if (exempt.some((selector) => el.matches(selector))) continue
        // Plain text links inside a sentence are exempt from the minimum; WCAG's "inline" exception.
        if (el.matches('a') && getComputedStyle(el).display === 'inline' && !isPrimary(el)) continue
        // A checkbox or radio is tapped through its label.
        const target = el.matches('input[type="checkbox"], input[type="radio"]') ? (el.closest('label') ?? el) : el
        const wanted = isPrimary(target) ? primaryMinimum : minimum
        if (!reach(target, wanted)) {
          const box = target.getBoundingClientRect()
          found.push({ control: describe(target), size: Math.round(Math.min(box.width, box.height)), wanted })
        }
      }
      return found
    },
    { controls: CONTROLS, primary: PRIMARY, exempt: EXEMPT, minimum: MINIMUM, primaryMinimum: PRIMARY_MINIMUM },
  )

test.use({ reducedMotion: 'reduce' })

for (const view of VIEWS) {
  test(`${view.replace('&tab=', ', ')} has no control with a tap area under its minimum`, async ({ page }) => {
    await page.goto(`/?section=${view}#full`)
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeAttached()
    await expect(page.locator('.analytik-skeleton, .analytik-chart-skeleton, [aria-busy="true"]')).toHaveCount(0)
    // Markers and their halos spring into place; measure them once they have stopped moving.
    await page.waitForFunction(
      () => {
        const w = window as unknown as { __shape?: string; __still?: number }
        const shape = [...document.querySelectorAll('.analytik [class$="-hit"]')]
          .map((el) => JSON.stringify(el.getBoundingClientRect()))
          .join()
        w.__still = shape === w.__shape ? (w.__still ?? 0) + 1 : 0
        w.__shape = shape
        return w.__still >= 5
      },
      undefined,
      { polling: 'raf' },
    )
    expect(await undersized(page)).toEqual([])
  })
}
