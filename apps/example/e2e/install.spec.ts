import { expect, test, type Page } from '@playwright/test'

const openOptions = async (page: Page) => {
  await page.getByRole('button', { name: /More options/ }).click()
  await expect(page.getByLabel('Your analytik host')).toBeVisible()
}

test('shows three numbered steps, each with something to copy', async ({ page }) => {
  await page.goto('/#install')
  const steps = page.locator('.steps-grid > li')
  await expect(steps).toHaveCount(3)
  await expect(steps.nth(0)).toContainText('Deploy the server')
  await expect(steps.nth(1)).toContainText('data-site="my-site"')
  await expect(steps.nth(2)).toContainText('<Dashboard')
  await expect(page.getByRole('button', { name: 'Copy the script tag' })).toBeVisible()
})

test('keeps the generator collapsed until asked', async ({ page }) => {
  await page.goto('/#install')
  const toggle = page.getByRole('button', { name: /More options/ })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByLabel('Your analytik host')).toBeHidden()
  await openOptions(page)
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
})

test('generates a script tag from the options', async ({ page }) => {
  await page.goto('/#install')
  await openOptions(page)
  await page.getByLabel('Your analytik host').fill('https://stats.acme.dev/')
  await page.getByLabel('Site id').fill('acme')
  await page.getByLabel('Privacy mode').selectOption('enriched')
  await page.getByLabel('Track localhost (for testing)').check()

  const code = page.locator('.code').first()
  await expect(code).toContainText('src="https://stats.acme.dev/analytik.js"')
  await expect(code).toContainText('data-site="acme"')
  await expect(code).toContainText('data-mode="enriched"')
  await expect(code).toContainText('data-allow-localhost="true"')
  // The step card shows the same tag.
  await expect(page.locator('.steps-grid > li').nth(1)).toContainText('data-site="acme"')
})

test('warns about an invalid host', async ({ page }) => {
  await page.goto('/#install')
  await openOptions(page)
  await page.getByLabel('Your analytik host').fill('not a url')
  await expect(page.getByText('Enter a full URL')).toBeVisible()
})

test('switches the snippet target', async ({ page }) => {
  await page.goto('/#install')
  await openOptions(page)
  await page.getByRole('tab', { name: 'React' }).click()
  await expect(page.locator('.code').first()).toContainText('AnalytikProvider')
  await page.getByRole('tab', { name: 'Server' }).click()
  await expect(page.locator('.code').first()).toContainText('createAnalytik')
})

test('builds the integration prompt for the chosen framework and the current options', async ({ page }) => {
  await page.goto('/#install')
  await openOptions(page)
  await page.getByLabel('Site id').fill('acme')

  const panel = page.getByRole('region', { name: 'Site integration prompt' })
  await panel.getByRole('radio', { name: 'Nuxt' }).check()
  const preview = panel.locator('pre')
  await expect(preview).toContainText('Add Analytik tracking to your Nuxt site')
  await expect(preview).toContainText('nuxt.config.ts')
  await expect(preview).toContainText("'data-site': 'acme'")
  await expect(preview).toContainText('/api/event')
  await expect(panel.getByTestId('prompt-count')).toHaveText(/^[\d,]+ characters$/)
})

test('builds the server prompt for the chosen platform', async ({ page }) => {
  await page.goto('/#install')
  const panel = page.getByRole('region', { name: 'Server setup prompt' })
  await panel.getByRole('radio', { name: 'Fly.io + SQLite' }).check()
  await expect(panel.locator('pre')).toContainText('Set up the Analytik server on Fly.io + SQLite')
  await expect(panel.locator('pre')).toContainText("sqliteStorage('/data/analytik.db')")
})

test('copies the integration prompt to the clipboard', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Reading the clipboard needs Chromium permissions')
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/#install')

  const panel = page.getByRole('region', { name: 'Site integration prompt' })
  await panel.getByRole('radio', { name: 'Next.js (App Router)' }).check()
  await panel.getByRole('button', { name: /^Copy the site integration prompt/ }).click()
  await expect(panel.getByRole('button', { name: /^Copy the site integration prompt/ })).toContainText('Copied')

  const text = await page.evaluate(() => navigator.clipboard.readText())
  expect(text).toContain('Next.js (App Router)')
  expect(text).toContain("import Script from 'next/script'")
  expect(text).toContain('strategy="afterInteractive"')
})
