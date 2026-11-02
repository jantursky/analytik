import { expect, test } from '@playwright/test'

import { DEMO_SHARE_TOKEN } from '../src/config'
import { watchErrors } from './helpers'

const shared = `/?site=demo&share=${DEMO_SHARE_TOKEN}#full`

test('a share link opens the dashboard read-only', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto(shared)
  await expect(page.getByText('Visitors').first()).toBeVisible()
  const nav = page.getByRole('navigation', { name: 'Dashboard' })
  await expect(nav.getByRole('button', { name: 'Overview' })).toBeVisible()
  for (const name of ['Settings', 'Revenue', 'All sites']) {
    await expect(nav.getByRole('button', { name })).toHaveCount(0)
  }
  await expect(page.getByRole('button', { name: 'Log out' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Customize' })).toHaveCount(0)
  await expect(page.getByLabel(/password/i)).toHaveCount(0)
  expect(errors).toEqual([])
})

test('the shared dashboard cannot reach admin data', async ({ request }) => {
  const get = (path: string) => request.get(`${path}${path.includes('?') ? '&' : '?'}share=${DEMO_SHARE_TOKEN}`)
  expect((await get('/api/sites/demo/overview')).status()).toBe(200)
  const overview = await get('/api/sites/demo/overview')
  expect(overview.headers()['cache-control']).toBe('public, s-maxage=60')
  const bad = await request.get('/api/sites/demo/overview?share=not-a-real-token-0123456789abcdef')
  expect(bad.headers()['cache-control']).not.toContain('public')
})
