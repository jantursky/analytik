import { expect, test } from '@playwright/test'

test('an address with a view, range, comparison and filter opens the same state in a fresh page', async ({
  browser,
  page,
}) => {
  await page.goto('/#full')
  await expect(page.getByText('Visitors').first()).toBeVisible()
  await page.getByRole('combobox', { name: 'Compare' }).click()
  await page.getByRole('option', { name: 'Previous period' }).click()
  await page
    .getByRole('button', { name: /, filter by this$/ })
    .first()
    .click()
  await expect(page.getByRole('group', { name: 'Active filters' })).toBeVisible()
  await expect(page).toHaveURL(/compare=previous/)
  const address = page.url()
  const chip = await page.locator('.analytik-chip').first().innerText()

  const fresh = await (await browser.newContext()).newPage()
  await fresh.goto(address)
  await expect(fresh.locator('.analytik-chip').first()).toHaveText(chip)
  await expect(fresh.getByRole('combobox', { name: 'Compare' })).toContainText('Previous period')
  await fresh.context().close()
})

test('a written address names the view, the range and a filter', async ({ page }) => {
  await page.goto('/?section=sessions&range=30d&f.country=US#full')
  await expect(page.getByRole('heading', { level: 1, name: 'Sessions' })).toBeAttached()
  await expect(page.getByRole('group', { name: 'Active filters' })).toContainText('US')
  await expect(page.getByRole('button', { name: /Past 30 days/ }).first()).toBeVisible()
  await expect(page).toHaveURL(/section=sessions/)
  await expect(page).toHaveURL(/range=30d/)
})
