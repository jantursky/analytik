import { expect, test } from '@playwright/test'

import { watchErrors } from './helpers'

test('the command palette opens with the shortcut, filters commands and opens a view', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/#full')
  await expect(page.getByText('Visitors').first()).toBeVisible()

  await page.keyboard.press('ControlOrMeta+K')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette).toBeVisible()
  await palette.getByRole('combobox', { name: 'Search commands' }).fill('sessions')
  await expect(palette.getByRole('option', { name: /Go to Sessions/ })).toBeVisible()
  await page.keyboard.press('Enter')

  await expect(palette).toBeHidden()
  await expect(page).toHaveURL(/section=sessions/)
  await expect(page.getByRole('heading', { level: 1, name: 'Sessions' })).toBeAttached()
  expect(errors).toEqual([])
})

test('the palette closes with Escape and says when nothing matches', async ({ page }) => {
  await page.goto('/#full')
  await expect(page.getByText('Visitors').first()).toBeVisible()
  await page.keyboard.press('ControlOrMeta+K')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await palette.getByRole('combobox', { name: 'Search commands' }).fill('zzzzqqq')
  await expect(palette.getByText('No matching commands').first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(palette).toBeHidden()
})
