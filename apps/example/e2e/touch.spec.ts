import { expect, test } from '@playwright/test'

import { watchErrors } from './helpers'

// Touch smoke tests, run on the Pixel 7 and iPhone 14 profiles (see playwright.config.ts). They tap instead of
// hovering, and fail when something works only with a mouse.

test('the navigation reaches every tab by tapping and the page does not scroll sideways', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/')
  for (const [name, heading] of [
    ['Instrumented site', 'A shop that reports to analytik'],
    ['Install', 'Install it on your site'],
    ['Privacy', 'What each mode stores'],
    ['Dashboard', 'The dashboard, reading live data'],
  ] as const) {
    const link = page.getByRole('link', { name, exact: true })
    await link.scrollIntoViewIfNeeded()
    await link.tap()
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(errors).toEqual([])
})

test('a copy button shows its copied state after a tap, without hover', async ({ page, context, browserName }) => {
  // Only Chromium has a permission to grant; WebKit allows the write that follows a tap.
  if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/#install')
  const copy = page.getByRole('button', { name: 'Copy the script tag' })
  await copy.scrollIntoViewIfNeeded()
  await copy.tap()
  await expect(copy).toContainText('Copied')
})

test('tapping a chart shows the value under the finger', async ({ page }) => {
  await page.goto('/#dashboard')
  const surface = page.locator('figure svg.recharts-surface').first()
  await expect(surface).toBeVisible()
  await surface.scrollIntoViewIfNeeded()
  const box = await surface.boundingBox()
  if (!box) throw new Error('The chart has no box')
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.locator('.analytik-chart-tip, .recharts-tooltip-wrapper [class*="tip"]').first()).toBeVisible()
})

test('the import dialog offers a file picker where there is no drag and drop', async ({ page }) => {
  await page.goto('/?section=sites#full')
  await page.getByRole('button', { name: 'Add website' }).tap()
  await page.getByRole('menuitem', { name: 'Import from another tool' }).tap()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Which tool are you importing from?')).toBeVisible()
  await dialog.getByRole('button').filter({ hasText: /Umami/ }).first().tap()
  await expect(dialog.getByText('Drop the export files here')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Choose files' })).toBeVisible()
  await expect(dialog.locator('input[type="file"]')).toBeAttached()
})
