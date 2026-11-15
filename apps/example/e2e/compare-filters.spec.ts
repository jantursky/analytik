import { expect, test } from '@playwright/test'

import { watchErrors } from './helpers'

test('comparing with the previous period puts the choice in the address and shows changes', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/#full')
  await expect(page.getByText('Visitors').first()).toBeVisible()

  await page.getByRole('combobox', { name: 'Compare' }).click()
  await page.getByRole('option', { name: 'Previous period' }).click()
  await expect(page).toHaveURL(/compare=previous/)
  await expect(page.locator('.analytik-delta').first()).toBeVisible()

  await page.getByRole('combobox', { name: 'Compare' }).click()
  await page.getByRole('option', { name: 'No comparison' }).click()
  await expect(page).not.toHaveURL(/compare=/)
  expect(errors).toEqual([])
})

test('a click on a breakdown row adds a filter chip that can be removed', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/#full')
  const row = page.getByRole('button', { name: /, filter by this$/ }).first()
  await expect(row).toBeVisible()
  await row.click()

  const filters = page.getByRole('group', { name: 'Active filters' })
  await expect(filters).toBeVisible()
  await expect(page).toHaveURL(/[?&]f\./)
  await filters.getByRole('button', { name: /^Remove filter/ }).click()
  await expect(filters).toBeHidden()
  await expect(page).not.toHaveURL(/[?&]f\./)
  expect(errors).toEqual([])
})
