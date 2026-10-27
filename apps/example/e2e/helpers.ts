import type { Page, Request } from '@playwright/test'

/** Collects uncaught errors and console errors so a test can assert there were none. */
export const watchErrors = (page: Page): string[] => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

const bodyOf = (request: Request): string => request.postData() ?? ''

/** Resolves with the body of the next tracker request of this type. */
export const nextTrackerEvent = async (page: Page, type: string): Promise<string> => {
  const request = await page.waitForRequest(
    (candidate) =>
      candidate.url().includes('/api/event') &&
      candidate.method() === 'POST' &&
      bodyOf(candidate).includes(`"t":"${type}"`),
  )
  return bodyOf(request)
}

/** The tracker ignores automated browsers (`navigator.webdriver`), so tests that read its requests switch that off. */
export const allowTracking = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false })
    // Playwright cannot read the Blob body of a beacon, so replay beacons as plain text requests it can see.
    navigator.sendBeacon = (url, data) => {
      void Promise.resolve(data).then(async (body) => {
        const text = body instanceof Blob ? await body.text() : typeof body === 'string' ? body : ''
        await fetch(url, { method: 'POST', body: text, keepalive: true, headers: { 'Content-Type': 'text/plain' } })
      })
      return true
    }
  })
}
