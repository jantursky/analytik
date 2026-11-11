import { afterEach, describe, expect, it, vi } from 'vitest'

import { Dashboard } from '../src/dashboard/index'
import { API_KEY_PASSWORD, fakeApi } from './dashboard-fixtures'
import { waitFor } from './dashboard-helpers'
import { actAsync, byLabel, byText, click, fill, render, settled, submit } from './react-render'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

async function open(custom = false) {
  const api = fakeApi()
  if (custom) api.state.login = 'custom'
  const { container } = await render(<Dashboard api="/api" fetcher={api.fetcher} siteId="site_1" view="settings" />)
  await settled()
  await click(byText(container, 'API keys', '.analytik-settings-nav button'))
  await settled()
  await waitFor(() => container.textContent.includes('No API keys yet.'))
  return { container, api }
}

const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]')
const secretInput = () => document.body.querySelector<HTMLInputElement>('input[aria-label="API key"]')

/** Types the name, submits the form and returns the open password dialog. */
async function startCreate(container: HTMLElement, name = 'Grafana') {
  const field = byLabel(container, 'Name')
  await fill(field, name)
  await submit(field?.closest('form'))
  return waitFor(dialog)
}

async function confirm(password: string, label: string) {
  const open = await waitFor(dialog)
  if (password) await fill(byLabel(open, 'Admin password'), password)
  await click(byText(open, label, 'button'))
}

describe('API keys in the settings', () => {
  it('creates a key behind the password dialog and shows the secret once', async () => {
    const { container, api } = await open()
    const asking = await startCreate(container)
    expect(asking.textContent).toContain('Type the admin password')
    expect(api.find('POST', '/api-keys')).toHaveLength(0)
    await confirm(API_KEY_PASSWORD, 'Create key')
    await waitFor(secretInput)
    expect(secretInput()?.value).toBe(`anl_${'N'.repeat(43)}`)
    expect(api.find('POST', '/api-keys')[0]?.body).toEqual({
      label: 'Grafana',
      scope: 'read',
      siteIds: [],
      expiresInDays: null,
      password: API_KEY_PASSWORD,
    })
    expect(document.body.querySelector<HTMLInputElement>('input[aria-label="Example request"]')?.value).toContain(
      '/v1/whoami',
    )
    await click(byText(document.body, 'Done', '[role="dialog"] button'))
    await waitFor(() => !secretInput())
    expect(document.body.textContent).not.toContain('N'.repeat(43))
    await waitFor(() => container.querySelector('.analytik-share-list')?.textContent.includes('Grafana'))
  })

  it('shows the server refusal in the dialog and keeps it open', async () => {
    const { container, api } = await open()
    await startCreate(container)
    await confirm('wrong', 'Create key')
    await waitFor(() => dialog()?.textContent.includes('wrong password'))
    expect(secretInput()).toBeNull()
    expect(api.state.apiKeys).toHaveLength(0)
    expect(dialog()?.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe('')
    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toBe('wrong password')
  })

  it('only asks to confirm when admins sign in another way', async () => {
    const { container, api } = await open(true)
    const asking = await startCreate(container)
    expect(asking.querySelector('input[type="password"]')).toBeNull()
    await confirm('', 'Create key')
    await waitFor(secretInput)
    expect(api.find('POST', '/api-keys')[0]?.body).not.toHaveProperty('password', expect.any(String))
  })

  it('rolls a key and shows the new secret once', async () => {
    const { container, api } = await open()
    await startCreate(container)
    await confirm(API_KEY_PASSWORD, 'Create key')
    await waitFor(secretInput)
    await click(byText(document.body, 'Done', '[role="dialog"] button'))
    await waitFor(() => byText(container, 'Roll', '.analytik-share-list button'))
    await click(byText(container, 'Roll', '.analytik-share-list button'))
    await settled()
    await confirm(API_KEY_PASSWORD, 'Roll key')
    await waitFor(() => secretInput()?.value === `anl_${'R'.repeat(43)}`)
    expect(api.find('POST', '/api-keys/ky_1/roll')[0]?.body).toEqual({ graceHours: 0, password: API_KEY_PASSWORD })
  })

  it('disables a key without a password, and enabling asks for it', async () => {
    const { container, api } = await open()
    await startCreate(container)
    await confirm(API_KEY_PASSWORD, 'Create key')
    await waitFor(secretInput)
    await click(byText(document.body, 'Done', '[role="dialog"] button'))
    await waitFor(() => byText(container, 'Disable', '.analytik-share-list button'))
    await click(byText(container, 'Disable', '.analytik-share-list button'))
    await waitFor(() => api.find('POST', '/api-keys/ky_1/disable').length === 1)
    expect(dialog()).toBeNull()
    await waitFor(() => byText(container, 'Enable', '.analytik-share-list button'))
    await click(byText(container, 'Enable', '.analytik-share-list button'))
    await settled()
    await confirm(API_KEY_PASSWORD, 'Enable')
    await waitFor(() => api.find('POST', '/api-keys/ky_1/enable').length === 1)
    expect(api.find('POST', '/api-keys/ky_1/enable')[0]?.body).toEqual({ password: API_KEY_PASSWORD })
  })

  it('deletes a key behind the password dialog', async () => {
    const { container, api } = await open()
    await startCreate(container)
    await confirm(API_KEY_PASSWORD, 'Create key')
    await waitFor(secretInput)
    await click(byText(document.body, 'Done', '[role="dialog"] button'))
    await waitFor(() => byText(container, 'Delete', '.analytik-share-list button'))
    await click(byText(container, 'Delete', '.analytik-share-list button'))
    await settled()
    await confirm(API_KEY_PASSWORD, 'Delete')
    await waitFor(() => api.find('DELETE', '/api-keys/ky_1').length === 1)
    await waitFor(() => container.textContent.includes('No API keys yet.'))
  })

  it('labels the password field and announces errors', async () => {
    const { container } = await open()
    const asking = await startCreate(container)
    const input = byLabel(asking, 'Admin password')
    expect(input?.getAttribute('autocomplete')).toBe('current-password')
    expect(input?.getAttribute('aria-describedby')).toBe(asking.querySelector('[role="alert"]')?.id)
  })

  it('selects a secret or command on focus and drops the secret when the dialog is closed', async () => {
    const { container } = await open()
    await startCreate(container)
    await confirm(API_KEY_PASSWORD, 'Create key')
    await waitFor(secretInput)
    const example = document.body.querySelector<HTMLInputElement>('input[aria-label="Example request"]')
    for (const input of [secretInput(), example]) {
      await actAsync(() => input?.focus())
    }
    await click(document.body.querySelector('[role="dialog"] button[aria-label="Close"]'))
    await waitFor(() => !secretInput())
    expect(document.body.textContent).not.toContain('N'.repeat(43))
  })

  it('lets the password dialog be cancelled, forgetting what was typed', async () => {
    const { container, api } = await open()
    const asking = await startCreate(container)
    await fill(byLabel(asking, 'Admin password'), 'half-typed')
    await click(byText(asking, 'Cancel', 'button'))
    await waitFor(() => !dialog())
    expect(api.find('POST', '/api-keys')).toHaveLength(0)
    await submit(byLabel(container, 'Name')?.closest('form'))
    const again = await waitFor(dialog)
    expect(byLabel(again, 'Admin password')?.value).toBe('')
  })

  it('lists what happened to the keys', async () => {
    const api = fakeApi()
    api.state.apiKeyEvents = [
      {
        id: 'e1',
        at: Date.UTC(2026, 9, 26),
        keyId: 'ky_1',
        label: 'Grafana',
        type: 'rolled',
        detail: 'old secret stopped at once',
      },
      { id: 'e2', at: Date.UTC(2026, 9, 25), keyId: 'ky_1', label: '', type: 'denied', detail: 'GET /email: closed' },
    ]
    const { container } = await render(<Dashboard api="/api" fetcher={api.fetcher} siteId="site_1" view="settings" />)
    await settled()
    await click(byText(container, 'API keys', '.analytik-settings-nav button'))
    await waitFor(() => container.textContent.includes('old secret stopped at once'))
    expect(container.textContent).toContain('Rolled')
    expect(container.textContent).toContain('Refused')
    expect(container.textContent).toContain('ky_1')
  })
  it('creates a key limited to the listed addresses, in canonical form', async () => {
    const { container, api } = await open()
    await fill(byLabel(container, 'Allowed addresses'), '203.0.113.9/24\n2001:DB8::1')
    await startCreate(container)
    await confirm(API_KEY_PASSWORD, 'Create key')
    await waitFor(secretInput)
    expect(api.find('POST', '/api-keys')[0]?.body).toMatchObject({ ipAllowlist: ['203.0.113.0/24', '2001:db8::1'] })
    await click(byText(document.body, 'Done', '[role="dialog"] button'))
    await waitFor(() => container.querySelector('.analytik-share-list')?.textContent.includes('2 addresses'))
  })

  it('shows an invalid entry at once and does not ask for the password', async () => {
    const { container, api } = await open()
    const field = byLabel(container, 'Allowed addresses')
    await fill(field, '10.0.0.1/33')
    await waitFor(() => container.querySelector('.analytik-field-error')?.textContent.includes('10.0.0.1/33'))
    expect(field?.getAttribute('aria-invalid')).toBe('true')
    await fill(byLabel(container, 'Name'), 'Grafana')
    await submit(byLabel(container, 'Name')?.closest('form'))
    await settled()
    expect(dialog()).toBeNull()
    expect(api.find('POST', '/api-keys')).toHaveLength(0)
  })

  it('warns when the list allows any address, and shows the address the server sees', async () => {
    const { container } = await open()
    await waitFor(() => container.textContent.includes('Your address as the server sees it: 203.0.113.9'))
    await fill(byLabel(container, 'Allowed addresses'), '0.0.0.0/0')
    await waitFor(() => container.textContent.includes('This allows any address.'))
  })

  it('changes the addresses of a key behind the password dialog, and clears them', async () => {
    const { container, api } = await open()
    await startCreate(container)
    await confirm(API_KEY_PASSWORD, 'Create key')
    await waitFor(secretInput)
    await click(byText(document.body, 'Done', '[role="dialog"] button'))
    await waitFor(() => byText(container, 'Addresses', '.analytik-share-list button'))
    expect(container.querySelector('.analytik-share-list')?.textContent).toContain('Any address')
    await click(byText(container, 'Addresses', '.analytik-share-list button'))
    const open1 = await waitFor(dialog)
    await fill(byLabel(open1, 'Allowed addresses'), '198.51.100.7')
    await confirm(API_KEY_PASSWORD, 'Save addresses')
    await waitFor(() => api.find('PATCH', '/api-keys/ky_1').length === 1)
    expect(api.find('PATCH', '/api-keys/ky_1')[0]?.body).toEqual({
      ipAllowlist: ['198.51.100.7'],
      password: API_KEY_PASSWORD,
    })
    await waitFor(() => container.querySelector('.analytik-share-list')?.textContent.includes('1 address'))
    await click(byText(container, 'Addresses', '.analytik-share-list button'))
    const open2 = await waitFor(dialog)
    expect(byLabel(open2, 'Allowed addresses')?.value).toBe('198.51.100.7')
    await fill(byLabel(open2, 'Allowed addresses'), '')
    await confirm(API_KEY_PASSWORD, 'Save addresses')
    await waitFor(() => api.find('PATCH', '/api-keys/ky_1').length === 2)
    expect(api.find('PATCH', '/api-keys/ky_1')[1]?.body).toEqual({ ipAllowlist: [], password: API_KEY_PASSWORD })
    await waitFor(() => container.querySelector('.analytik-share-list')?.textContent.includes('Any address'))
  })

  it('shows the server message when saving addresses is refused', async () => {
    const { container, api } = await open()
    await startCreate(container)
    await confirm(API_KEY_PASSWORD, 'Create key')
    await waitFor(secretInput)
    await click(byText(document.body, 'Done', '[role="dialog"] button'))
    await waitFor(() => byText(container, 'Addresses', '.analytik-share-list button'))
    await click(byText(container, 'Addresses', '.analytik-share-list button'))
    const open1 = await waitFor(dialog)
    await fill(byLabel(open1, 'Allowed addresses'), '198.51.100.7')
    await confirm('wrong', 'Save addresses')
    await waitFor(() => dialog()?.textContent.includes('wrong password'))
    expect(api.state.apiKeys[0]?.ipAllowlist).toEqual([])
  })

  it('labels the address events in the activity list', async () => {
    const api = fakeApi()
    api.state.apiKeyEvents = [
      {
        id: 'e1',
        at: Date.UTC(2026, 9, 26),
        keyId: 'ky_1',
        label: 'Grafana',
        type: 'denied_ip',
        detail: '198.51.100.9',
      },
      {
        id: 'e2',
        at: Date.UTC(2026, 9, 25),
        keyId: 'ky_1',
        label: 'Grafana',
        type: 'allowlist_changed',
        detail: '0 to 1 addresses',
      },
    ]
    const { container } = await render(<Dashboard api="/api" fetcher={api.fetcher} siteId="site_1" view="settings" />)
    await settled()
    await click(byText(container, 'API keys', '.analytik-settings-nav button'))
    await waitFor(() => container.textContent.includes('198.51.100.9'))
    expect(container.textContent).toContain('Refused address')
    expect(container.textContent).toContain('Addresses changed')
  })
})
