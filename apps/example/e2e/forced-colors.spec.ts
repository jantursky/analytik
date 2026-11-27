import { expect, type Page, test } from '@playwright/test'

import { watchErrors } from './helpers'

// Forced colors are emulated in Chromium only; Firefox and WebKit do not support the emulation.
test.skip(({ browserName }) => browserName !== 'chromium', 'forced colors are emulated in Chromium only')
test.use({ forcedColors: 'active', reducedMotion: 'reduce' })

const systemColor = (page: Page, name: string): Promise<string> =>
  page.evaluate((color) => {
    const probe = document.createElement('i')
    probe.style.color = color
    document.body.append(probe)
    const resolved = getComputedStyle(probe).color
    probe.remove()
    return resolved
  }, name)

test('a focused control has an outline in a system color', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/?section=overview#full')
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeAttached()
  await page.keyboard.press('Tab')
  const outline = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement!)
    return { color: style.outlineColor, style: style.outlineStyle, width: style.outlineWidth }
  })
  expect(outline.style).toBe('solid')
  expect(outline.width).toBe('2px')
  expect(outline.color).toBe(await systemColor(page, 'Highlight'))
  expect(errors).toEqual([])
})

test('the selected tab differs from the others by more than color', async ({ page }) => {
  await page.goto('/?section=sources#full')
  const tabs = page.locator('.analytik-tab')
  await expect(tabs.first()).toBeVisible()
  const selected = tabs.locator('xpath=self::*[@data-active]').first()
  await expect(selected).toBeVisible()
  const outlines = await tabs.evaluateAll((all) =>
    all.map((tab) => ({ active: tab.hasAttribute('data-active'), style: getComputedStyle(tab).outlineStyle })),
  )
  expect(outlines.filter((tab) => tab.active).every((tab) => tab.style === 'solid')).toBe(true)
  expect(outlines.filter((tab) => !tab.active).every((tab) => tab.style === 'none')).toBe(true)
})

test('a switch and a popup keep a visible edge', async ({ page }) => {
  await page.goto('/?section=settings&tab=privacy#full')
  const toggle = page.locator('.analytik-switch').first()
  await expect(toggle).toBeVisible()
  expect(await toggle.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe('solid')
})
