import { expect, test } from '@playwright/test'

import { watchErrors } from './helpers'

test('hiding a view in Settings removes it from the navigation and survives a reload', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/?section=settings&tab=appearance#full')
  const nav = page.locator('.analytik-nav-item')
  await expect(nav.filter({ hasText: 'Bots' })).toHaveCount(1)

  await page.getByRole('switch', { name: 'Bots' }).click()
  await expect(nav.filter({ hasText: 'Bots' })).toHaveCount(0)

  await page.reload()
  await expect(page.getByRole('switch', { name: 'Bots' })).not.toBeChecked()
  await expect(nav.filter({ hasText: 'Bots' })).toHaveCount(0)

  // Reset shows it again.
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await expect(nav.filter({ hasText: 'Bots' })).toHaveCount(1)
  expect(errors).toEqual([])
})

test('a view can be moved up with the keyboard', async ({ page }) => {
  await page.goto('/?section=settings&tab=appearance#full')
  const nav = page.locator('.analytik-nav-item')
  await expect(nav.filter({ hasText: 'Pages' }).first()).toBeVisible()
  const labels = async () => (await nav.allTextContents()).map((text) => text.trim())
  const before = await labels()
  expect(before.indexOf('Pages')).toBeGreaterThan(before.indexOf('Acquisition'))
  const button = page.getByRole('button', { name: 'Move Pages earlier' })
  await button.focus()
  await page.keyboard.press('Enter')
  const after = await labels()
  expect(after.indexOf('Pages')).toBeLessThan(after.indexOf('Acquisition'))
  await expect(page.getByRole('button', { name: 'Move Pages earlier' })).toBeFocused()
})
