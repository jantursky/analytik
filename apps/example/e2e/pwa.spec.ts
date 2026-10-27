import { expect, test } from '@playwright/test'

test('the manifest names the app and lists installable icons', async ({ page, request }) => {
  await page.goto('/')
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest')
  const manifest = (await (await request.get('/manifest.webmanifest')).json()) as {
    name: string
    display: string
    start_url: string
    icons: { src: string; sizes: string; purpose?: string }[]
  }
  expect(manifest).toMatchObject({ name: 'Analytik demo', display: 'standalone', start_url: '/#dashboard' })
  expect(manifest.icons.map((icon) => icon.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']))
  expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true)
  for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true)
})

test('opens offline once the service worker has run', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Offline emulation with a service worker is reliable in Chromium only')
  await page.goto('/#dashboard')
  await page.evaluate(() => navigator.serviceWorker.ready)
  // A second load goes through the worker, which keeps the page and its build files.
  await page.reload()
  await expect(page.getByText('Visitors').first()).toBeVisible()
  await context.setOffline(true)
  await page.reload()
  await expect(page.locator('.header')).toBeVisible()
  await context.setOffline(false)
})
