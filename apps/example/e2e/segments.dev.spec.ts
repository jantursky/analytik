import { expect, test } from '@playwright/test'

import { watchErrors } from './helpers'

// Runs against the dev server, where writes are allowed (see playwright.config.ts).

test('saves the active filters as a segment and applies it again after a reload', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/#full')
  await page
    .getByRole('button', { name: /, filter by this$/ })
    .first()
    .click()
  const chip = page.locator('.analytik-chip').first()
  await expect(chip).toBeVisible()
  const filter = await chip.innerText()

  await page.getByRole('button', { name: 'Segments' }).click()
  await page.getByRole('menuitem', { name: 'Save the active filters…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Save segment' })
  await dialog.getByLabel('Name').fill('Saved by e2e')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog).toBeHidden()

  await page.getByRole('button', { name: /Remove filter/ }).click()
  await expect(chip).toBeHidden()
  await page.reload()
  await page.getByRole('button', { name: 'Segments' }).click()
  await page.getByRole('menuitem', { name: /Saved by e2e/ }).click()
  await expect(page.locator('.analytik-chip').first()).toHaveText(filter)
  expect(errors).toEqual([])
})

test('a changed site setting is saved on the server', async ({ page, request }) => {
  await page.goto('/#dashboard')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByLabel('Name', { exact: true }).fill('Renamed by e2e')
  await page.getByRole('button', { name: 'Save', exact: true }).first().click()
  await expect
    .poll(async () => ((await (await request.get('/api/sites/demo')).json()) as { name: string }).name)
    .toBe('Renamed by e2e')
})
