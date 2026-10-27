import { expect, test } from '@playwright/test'

import { watchErrors } from './helpers'

test('the dashboard loads seeded data without a login', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/#dashboard')
  await expect(page.getByText('Visitors').first()).toBeVisible()
  await expect(page.getByLabel(/password/i)).toHaveCount(0)
  expect(errors).toEqual([])
})

test('the API serves the seeded site and refuses writes', async ({ request }) => {
  const health = await request.get('/api/health')
  expect(health.ok()).toBe(true)

  const overview = await request.get('/api/sites/demo/overview')
  expect(overview.ok()).toBe(true)
  const body = (await overview.json()) as { visitors: { value: number } }
  expect(body.visitors.value).toBeGreaterThan(0)

  for (const response of [
    await request.delete('/api/sites/demo'),
    await request.delete('/api/sites/demo/data?before=2100-01-01'),
    await request.post('/api/sites', { data: { name: 'x', domain: 'x.test' } }),
    await request.patch('/api/sites/demo', { data: { name: 'x' } }),
  ]) {
    expect(response.status()).toBe(403)
  }
})
