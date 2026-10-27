import { expect, test } from '@playwright/test'

import { watchErrors } from './helpers'

test('opens on the dashboard and switches sections by hash', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')

  for (const [name, heading] of [
    ['Instrumented site', 'A shop that reports to analytik'],
    ['Install', 'Install it on your site'],
    ['Privacy', 'What each mode stores'],
    ['Dashboard', 'The dashboard, reading live data'],
  ] as const) {
    await page.getByRole('link', { name, exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
  }
  expect(errors).toEqual([])
})

test('deep links by hash', async ({ page }) => {
  await page.goto('/#privacy')
  await expect(page.getByRole('link', { name: 'Privacy' })).toHaveAttribute('aria-current', 'page')
})

test('view source shows the example file', async ({ page }) => {
  await page.goto('/#site')
  await page.getByRole('button', { name: 'View source' }).click()
  const panel = page.getByRole('complementary', { name: 'Source of ShopExample.tsx' })
  await expect(panel).toContainText('useTrackPageviews')
  await page.getByRole('button', { name: 'Hide source' }).click()
  await expect(panel).toBeHidden()
})

test.describe('at 360 px', () => {
  test.use({ viewport: { width: 360, height: 740 } })

  for (const tab of ['dashboard', 'site', 'install', 'privacy']) {
    test(`#${tab} does not scroll sideways and the nav reaches every tab`, async ({ page }) => {
      await page.goto(`/#${tab}`)
      await expect(page.locator('h1.title')).toBeVisible()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow).toBeLessThanOrEqual(0)
      await page.getByRole('link', { name: 'Privacy', exact: true }).click()
      await expect(page.getByRole('heading', { level: 1, name: 'What each mode stores' })).toBeVisible()
    })
  }
})
