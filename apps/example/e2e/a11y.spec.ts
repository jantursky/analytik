import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

// Animations fade content in; axe would measure contrast mid-fade, so run without them.
test.use({ reducedMotion: 'reduce' })

for (const tab of ['site', 'install', 'privacy']) {
  test(`#${tab} has no detectable accessibility violations`, async ({ page }) => {
    await page.goto(`/#${tab}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const { violations } = await new AxeBuilder({ page }).analyze()
    expect(violations).toEqual([])
  })
}

test('#install with the options open has no detectable accessibility violations', async ({ page }) => {
  await page.goto('/#install')
  await page.getByRole('button', { name: /More options/ }).click()
  await expect(page.getByLabel('Your analytik host')).toBeVisible()
  const { violations } = await new AxeBuilder({ page }).analyze()
  expect(violations).toEqual([])
})
