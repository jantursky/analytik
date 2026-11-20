import { afterEach, describe, expect, it, vi } from 'vitest'

import { Dashboard } from '../src/dashboard/index'
import { fakeApi, session } from './dashboard-fixtures'
import { waitFor } from './dashboard-helpers'
import { byText, click, render, settled } from './react-render'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

async function openTimeline() {
  const api = fakeApi()
  const { container } = await render(<Dashboard api="/api" fetcher={api.fetcher} siteId="site_1" view="sessions" />)
  await settled()
  await click(container.querySelector('tbody .analytik-row-button'))
  await waitFor(() => document.querySelector('[role="dialog"] .analytik-timeline'))
  return api
}

const found = (selector: string): Element => {
  const element = document.querySelector(selector)
  if (!element) throw new Error(`nothing matches ${selector}`)
  return element
}
const dialog = () => found('[role="dialog"]')

describe('erasing a visitor from their timeline', () => {
  it('offers the visitor’s data as a download of their own id', async () => {
    await openTimeline()
    const link = byText(dialog(), 'Download their data', 'a')
    expect(link?.getAttribute('href')).toBe(`/api/sites/site_1/visitors/export?visitor=${session.visitorId}`)
    expect(link?.hasAttribute('download')).toBe(true)
  })

  it('deletes nothing when the confirmation is cancelled', async () => {
    const api = await openTimeline()
    await click(byText(dialog(), 'Erase visitor data', 'button'))
    await settled()
    expect(document.body.textContent).toContain('Erase everything about this visitor?')
    expect(document.body.textContent).toContain('This cannot be undone.')
    await click(byText(document.body, 'Cancel', '[role="dialog"] button'))
    await settled()
    expect(api.find('DELETE', '/sites/site_1/visitors')).toHaveLength(0)
  })

  it('erases by the visitor’s id and shows what was removed', async () => {
    const api = await openTimeline()
    await click(byText(dialog(), 'Erase visitor data', 'button'))
    await settled()
    await click(found('[data-variant="danger-solid"]'))
    await waitFor(() => api.find('DELETE', '/sites/site_1/visitors').length === 1)
    expect(api.find('DELETE', '/sites/site_1/visitors')[0]?.params).toEqual({ visitor: session.visitorId })
    await waitFor(() => document.body.textContent.includes('Erased. Events: 12, sessions: 3'))
  })
})
