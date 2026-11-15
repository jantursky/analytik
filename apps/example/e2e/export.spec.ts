import { expect, test, type Page, type Request } from '@playwright/test'

/** Requests that would change something on the server; the tracker's own writes are not the dashboard's. */
const writes = (page: Page): Request[] => {
  const seen: Request[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (!url.pathname.startsWith('/api/')) return
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return
    if (/\/api\/(event|attribution)$/.test(url.pathname)) return
    seen.push(request)
  })
  return seen
}

test('exports a breakdown as CSV without writing anything', async ({ page }) => {
  const seen = writes(page)
  await page.goto('/?section=sources#full')
  const button = page.getByRole('button', { name: 'Export CSV' }).first()
  await expect(button).toBeVisible()
  const download = page.waitForEvent('download')
  await button.click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/\.csv$/)
  expect(seen).toEqual([])
})

test('exports a chart as PNG without writing anything', async ({ page }) => {
  const seen = writes(page)
  await page.goto('/#full')
  // The chart is drawn by a lazy chunk; exporting before it exists has nothing to save.
  await expect(page.locator('figure svg.recharts-surface').first()).toBeVisible()
  const button = page.getByRole('button', { name: 'Export PNG' }).first()
  await expect(button).toBeAttached()
  const download = page.waitForEvent('download')
  await button.click({ force: true })
  const file = await download
  expect(file.suggestedFilename()).toMatch(/\.png$/)
  expect(seen).toEqual([])
})
