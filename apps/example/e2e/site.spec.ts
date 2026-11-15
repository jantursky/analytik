import { expect, test } from '@playwright/test'

import { allowTracking, nextTrackerEvent } from './helpers'

test('walks the shop and reports a revenue event on the thank-you page', async ({ page }) => {
  await allowTracking(page)
  await page.goto('/#site')
  const url = page.getByTestId('shop-url')
  await expect(url).toHaveText('/')

  await page.getByRole('button', { name: 'See pricing' }).click()
  await expect(url).toHaveText('/pricing')
  await expect(page).toHaveURL(/\/pricing#site$/)

  await page.getByRole('button', { name: 'Buy Studio' }).click()
  await expect(url).toHaveText('/checkout')
  await page.getByLabel('Email for the receipt').fill('reader@example.com')

  const revenue = nextTrackerEvent(page, 'revenue')
  await page.getByRole('button', { name: 'Pay $79' }).click()
  await expect(page.getByRole('heading', { name: 'Thank you!' })).toBeVisible()

  const body = await revenue
  expect(body).toContain('"a":79')
  expect(body).toContain('"c":"USD"')
})

test('sends a goal when a plan is chosen', async ({ page }) => {
  await allowTracking(page)
  await page.goto('/pricing#site')
  const goal = nextTrackerEvent(page, 'goal')
  await page.getByRole('button', { name: 'Buy Solo' }).click()
  expect(await goal).toContain('plan_select')
})

test('the consent switch moves between strict and enriched mode', async ({ page }) => {
  await page.goto('/#site')
  const consent = page.getByRole('switch', { name: 'Analytics consent' })
  const badge = page.getByTestId('mode-badge')
  await expect(consent).toHaveAttribute('aria-checked', 'false')
  await expect(badge).toHaveText('strict')

  await consent.click()
  await expect(consent).toHaveAttribute('aria-checked', 'true')
  await expect(badge).toHaveText('enriched')

  await consent.click()
  await expect(badge).toHaveText('strict')
})

test('the thank-you page links to the dashboard view where the order shows', async ({ page }) => {
  await page.goto('/checkout#site')
  await page.getByLabel('Email for the receipt').fill('reader@example.com')
  await page.getByRole('button', { name: /^Pay / }).click()
  await page.getByRole('link', { name: 'See it in the dashboard' }).click()
  await expect(page.getByRole('link', { name: 'Full page' })).toHaveAttribute('aria-current', 'page')
  await expect(page).toHaveURL(/section=revenue/)
  await expect(page.getByRole('heading', { level: 1, name: 'Revenue' })).toBeAttached()
})
