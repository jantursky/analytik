import { expect, test } from '@playwright/test'

import { watchErrors } from './helpers'

test('customizes the overview: adds a block from the catalogue and resets the layout', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/#dashboard')
  const blocks = page.locator('.analytik-board > .analytik-block:not(.analytik-add-block)')
  await expect(blocks).toHaveCount(6)
  await page.getByRole('button', { name: 'Customize' }).click()

  await page.locator('.analytik-add-tile').click()
  const picker = page.getByRole('dialog', { name: 'Add a block' })
  await picker.getByRole('button', { name: /^Revenue/ }).click()
  await picker.getByRole('checkbox', { name: /Average order value/ }).click()
  await picker.getByRole('button', { name: 'Add block' }).click()
  await expect(blocks).toHaveCount(7)
  await expect(blocks.last()).toContainText('Average order value')

  await page.getByRole('button', { name: 'Add a block after Acquisition' }).click()
  await page
    .getByRole('dialog', { name: 'Add a block' })
    .getByRole('checkbox', { name: /Live now/ })
    .click()
  await page
    .getByRole('dialog', { name: 'Add a block' })
    .getByRole('checkbox', { name: /Recent payments/ })
    .click()
  await page.getByRole('button', { name: 'Add 2 blocks' }).click()
  await expect(blocks.nth(2)).toContainText('Live now')
  await expect(blocks.nth(3)).toContainText('Recent payments')

  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await page.getByRole('dialog', { name: 'Reset the overview?' }).getByRole('button', { name: 'Reset layout' }).click()
  await expect(blocks).toHaveCount(6)
  await page.getByRole('button', { name: 'Done' }).click()
  expect(errors).toEqual([])
})

test('keeps the toolbar in view while the overview scrolls', async ({ page }) => {
  await page.goto('/#dashboard')
  const toolbar = page.locator('.analytik-toolbar')
  await expect(toolbar).toBeVisible()
  await page.mouse.wheel(0, 1500)
  await expect.poll(async () => (await toolbar.boundingBox())?.y ?? -1).toBeGreaterThanOrEqual(0)
  const box = await toolbar.boundingBox()
  expect(box && box.y < 250).toBe(true)
})

test('plots a number on its own when it is clicked', async ({ page }) => {
  await page.goto('/#dashboard')
  await page.locator('button.analytik-stat', { hasText: 'Bounce rate' }).click()
  await expect(page.getByText('Bounce rate over time')).toBeVisible()
  await page.getByRole('button', { name: 'Back to visitors and revenue' }).click()
  await expect(page.getByText('Bounce rate over time')).toHaveCount(0)
})
