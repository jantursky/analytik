import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import { watchErrors } from './helpers'

test.use({ reducedMotion: 'reduce' })

test('the chart style chosen in Settings applies at once and survives a reload', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/?section=settings&tab=appearance#full')
  const root = page.locator('.analytik[data-theme], .analytik').first()
  await expect(root).not.toHaveAttribute('data-chart-style', /.+/)

  await page.getByRole('combobox', { name: 'Style' }).click()
  await page.getByRole('option', { name: 'Dither' }).click()
  await expect(root).toHaveAttribute('data-chart-style', 'dither')

  await page.reload()
  await expect(root).toHaveAttribute('data-chart-style', 'dither')

  await page.getByRole('combobox', { name: 'Style' }).click()
  await page.getByRole('option', { name: 'ASCII' }).click()
  await expect(root).toHaveAttribute('data-chart-style', 'ascii')

  await page.getByRole('combobox', { name: 'Style' }).click()
  await page.getByRole('option', { name: 'Default' }).click()
  await expect(root).not.toHaveAttribute('data-chart-style', /.+/)
  expect(errors).toEqual([])
})

for (const style of ['dither', 'ascii']) {
  for (const scheme of ['light', 'dark'] as const) {
    for (const view of ['overview', 'sources', 'events', 'funnels', 'journeys', 'retention', 'revenue']) {
      test(`${view} in the ${style} style, ${scheme} scheme, has no detectable accessibility violations`, async ({
        page,
      }) => {
        await page.emulateMedia({ colorScheme: scheme })
        await page.addInitScript((value) => {
          localStorage.setItem('analytik:preferences', JSON.stringify({ chartStyle: value }))
        }, style)
        await page.goto(`/?section=${view}#full`)
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeAttached()
        await expect(page.locator('.analytik-skeleton, .analytik-chart-skeleton, [aria-busy="true"]')).toHaveCount(0)
        await expect(page.locator('.analytik').first()).toHaveAttribute('data-chart-style', style)
        await page.waitForFunction(() =>
          [...document.querySelectorAll('.analytik-card[style*="opacity"]')].every(
            (el) => getComputedStyle(el).opacity === '1',
          ),
        )
        const { violations } = await new AxeBuilder({ page }).exclude('[data-base-ui-focus-guard]').analyze()
        expect(violations).toEqual([])
      })
    }
  }
}
