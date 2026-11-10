import { afterEach, describe, expect, it, vi } from 'vitest'

import { Dashboard } from '../src/dashboard/index'
import { fakeApi } from './dashboard-fixtures'
import { waitFor } from './dashboard-helpers'
import { byLabel, byText, click, fill, render, settled, submit } from './react-render'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

async function open() {
  const api = fakeApi()
  const { container } = await render(<Dashboard api="/api" fetcher={api.fetcher} siteId="site_1" view="settings" />)
  await settled()
  await click(byText(container, 'Payments and API', '.analytik-settings-nav button'))
  await settled()
  return { container, api }
}

describe('outgoing webhooks in the settings', () => {
  it('adds a webhook, shows its secret once, and lists it by host', async () => {
    const { container, api } = await open()
    await waitFor(() => container.textContent.includes('No webhooks yet.'))
    const address = byLabel(container, 'Address')
    await fill(address, 'https://hooks.example.com/services/secret-path')
    await submit(address?.closest('form'))
    await waitFor(() => container.querySelector('input[aria-label="Signing secret"]'))
    expect(api.find('POST', '/sites/site_1/webhooks')[0]?.body).toEqual({
      url: 'https://hooks.example.com/services/secret-path',
      events: ['goal', 'payment'],
      format: 'json',
    })
    await waitFor(() => container.querySelector('.analytik-share-list'))
    expect(container.querySelector('.analytik-share-list')?.textContent).toContain('hooks.example.com')
    expect(container.querySelector('.analytik-share-list')?.textContent).not.toContain('secret-path')
  })

  it('pauses, tests and removes a webhook', async () => {
    const { container, api } = await open()
    const address = byLabel(container, 'Address')
    await fill(address, 'https://hooks.example.com/a')
    await submit(address?.closest('form'))
    await waitFor(() => container.querySelector('.analytik-share-list'))

    await click(byText(container, 'Pause', 'button'))
    await waitFor(() => api.find('PATCH', '/sites/site_1/webhooks/wh_1').length === 1)
    expect(api.find('PATCH', '/sites/site_1/webhooks/wh_1')[0]?.body).toEqual({ paused: true })
    await waitFor(() => byText(container, 'Resume', 'button'))

    await click(byText(container, 'Send test', 'button'))
    await waitFor(() => container.textContent.includes('Test sent'))
    expect(api.find('POST', '/sites/site_1/webhooks/wh_1/test')).toHaveLength(1)

    await click(byText(container, 'Remove', '.analytik-share-list button'))
    await settled()
    await click(byText(document.body, 'Remove', '[role="alertdialog"] button, [role="dialog"] button:last-of-type'))
    await waitFor(() => api.find('DELETE', '/sites/site_1/webhooks/wh_1').length === 1)
    await waitFor(() => container.textContent.includes('No webhooks yet.'))
  })
})
