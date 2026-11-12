import { expect, test } from '@playwright/test'

import { watchErrors } from './helpers'

test('switching the language translates the dashboard and survives a reload', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/#full')
  await expect(page.getByText('Visitors').first()).toBeVisible()

  await page.getByRole('button', { name: 'Language' }).click()
  await page.getByRole('menuitemradio', { name: 'Slovenčina' }).click()
  await expect(page.getByRole('combobox', { name: 'Porovnať' })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Porovnať' })).toBeVisible()
  expect(errors).toEqual([])
})

test('the theme button cycles light, dark and system', async ({ page }) => {
  await page.goto('/#full')
  const toggle = page.locator('.analytik-theme-toggle')
  await expect(toggle).toBeVisible()
  const seen = new Set<string>()
  for (let i = 0; i < 3; i++) {
    seen.add((await toggle.getAttribute('aria-label')) ?? '')
    await toggle.click()
  }
  expect(seen.size).toBe(3)
  // Dark by choice sets the theme on the dashboard root.
  while (!(await toggle.getAttribute('aria-label'))?.startsWith('Theme: Dark')) await toggle.click()
  await expect(page.locator('[data-theme="dark"]').first()).toBeAttached()
})
