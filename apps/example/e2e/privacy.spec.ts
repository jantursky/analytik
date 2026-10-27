import { expect, test } from '@playwright/test'

test('describes each mode', async ({ page }) => {
  await page.goto('/#privacy')
  const storage = page.getByTestId('fact-storage')
  await expect(storage).toContainText('Nothing')

  await page.getByRole('button', { name: 'Enriched' }).click()
  await expect(storage).toContainText('sessionStorage')

  await page.getByRole('button', { name: 'Persistent' }).click()
  await expect(storage).toContainText('analytik_vid')
})

test('the visitor id depends on the IP and changes when the salt is deleted', async ({ page }) => {
  await page.goto('/#privacy')
  const id = page.getByTestId('visitor-id')
  await expect(id).toHaveText(/^[0-9a-f]{16}$/)
  const first = await id.textContent()

  await page.getByLabel(/IP address/).fill('198.51.100.9')
  await expect(id).not.toHaveText(first ?? '')

  await page.getByLabel(/IP address/).fill('203.0.113.7')
  await expect(id).toHaveText(first ?? '')

  await page.getByRole('button', { name: 'End the month (delete the salt)' }).click()
  await expect(id).not.toHaveText(first ?? '')
})

test('strict mode leaves nothing on the device', async ({ page }) => {
  await page.goto('/#site')
  await page.getByRole('button', { name: 'See pricing' }).click()
  await page.getByRole('link', { name: 'Privacy' }).click()
  await expect(page.getByTestId('device-cookies')).toHaveText('none')
  await expect(page.getByTestId('device-local')).toHaveText('none')
  await expect(page.getByTestId('device-session')).toHaveText('none')
})
