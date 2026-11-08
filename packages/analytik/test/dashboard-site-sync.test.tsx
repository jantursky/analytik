import { afterEach, describe, expect, it, vi } from 'vitest'

import { Dashboard } from '../src/dashboard/index'
import { fakeApi } from './dashboard-fixtures'
import { waitFor } from './dashboard-helpers'
import { byLabel, byText, click, fill, render, settled, submit } from './react-render'

async function open(api = fakeApi()) {
  const view = await render(<Dashboard api="/api" fetcher={api.fetcher} siteId="site_1" view="settings" />)
  await settled()
  return { ...view, api }
}

const card = (container: Element) =>
  byText(container, 'Sync from website', '*')!.closest<HTMLElement>('.analytik-card')!
const boxes = (container: Element) => [...card(container).querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('Sync from website in the site settings', () => {
  it('reads the page on request, ticks what is safe to take, and applies the ticked fields only', async () => {
    const { container, api } = await open()
    expect(api.find('POST', '/sites/site_1/sync')).toHaveLength(0)
    await click(byText(card(container), 'Check website', 'button'))
    await waitFor(() => (boxes(container).length === 3 ? true : null))
    // The name was typed by hand, so it starts unticked and says so.
    expect(boxes(container).map((box) => box.checked)).toEqual([false, true, true])
    expect(card(container).textContent).toContain('Set by hand')
    expect(card(container).textContent).toContain('Example Shop')
    expect(card(container).textContent).toContain('The tracker was not found on the page')

    await click(byText(card(container), 'Apply selected', 'button'))
    await waitFor(() => api.find('POST', '/sites/site_1/sync/apply')[0] ?? null)
    expect(api.find('POST', '/sites/site_1/sync/apply')[0]?.body).toEqual({ fields: ['color', 'icon'] })
    await settled()
    expect(card(container).textContent).toContain('Website details applied')
    // The list is gone until the page is read again.
    expect(boxes(container)).toHaveLength(0)
  })

  it('takes the name too when it is ticked, and keeps Apply off with nothing ticked', async () => {
    const { container, api } = await open()
    await click(byText(card(container), 'Check website', 'button'))
    await waitFor(() => (boxes(container).length === 3 ? true : null))
    await click(boxes(container)[0])
    expect(boxes(container)[0]?.checked).toBe(true)
    await click(byText(card(container), 'Apply selected', 'button'))
    await waitFor(() => api.find('POST', '/sites/site_1/sync/apply')[0] ?? null)
    expect(api.find('POST', '/sites/site_1/sync/apply')[0]?.body).toEqual({ fields: ['name', 'color', 'icon'] })

    const again = await open()
    await click(byText(card(again.container), 'Check website', 'button'))
    await waitFor(() => (boxes(again.container).length === 3 ? true : null))
    for (const box of boxes(again.container).filter((b) => b.checked)) await click(box)
    expect((byText(card(again.container), 'Apply selected', 'button') as HTMLButtonElement).disabled).toBe(true)
  })

  it('says so when the website already matches, cannot be read, or is a generated test site', async () => {
    const matching = fakeApi()
    matching.state.sync = {
      reachable: true,
      tracker: 'found',
      changes: [{ field: 'name', current: 'Example', found: 'Example', changed: false }],
    }
    const first = await open(matching)
    await click(byText(card(first.container), 'Check website', 'button'))
    await waitFor(() => byText(card(first.container), 'The website already matches.') ?? null)
    expect(card(first.container).textContent).toContain('The tracker is on the page.')
    expect(byText(card(first.container), 'Apply selected', 'button')).toBeUndefined()

    const down = fakeApi()
    down.state.sync = { reachable: false, tracker: 'unknown', changes: [] }
    const second = await open(down)
    await click(byText(card(second.container), 'Check website', 'button'))
    await waitFor(() => byText(card(second.container), 'The website could not be read.') ?? null)

    const test = fakeApi()
    test.state.sync = { skipped: 'test-site', reachable: false, tracker: 'unknown', changes: [] }
    const third = await open(test)
    await click(byText(card(third.container), 'Check website', 'button'))
    await waitFor(() => byText(card(third.container), 'A generated test site has no website to read.') ?? null)
  })

  it('shows the server’s error when applying fails', async () => {
    const api = fakeApi()
    api.state.syncFails = true
    const { container } = await open(api)
    await click(byText(card(container), 'Check website', 'button'))
    await waitFor(() => (boxes(container).length === 3 ? true : null))
    await click(byText(card(container), 'Apply selected', 'button'))
    await waitFor(() => byText(card(container), 'the website could not be read') ?? null)
  })
})

describe('adding a website', () => {
  async function start() {
    const api = fakeApi()
    api.state.sites = []
    const view = await render(<Dashboard api="/api" fetcher={api.fetcher} />)
    await settled()
    return { api, container: view.container }
  }
  const create = async (container: Element, name: string) => {
    await fill(byLabel(container, 'Domain'), 'shop.example.com')
    if (name) await fill(byLabel(container, 'Name'), name)
    await submit(container.querySelector('form.analytik-site-form'))
    await settled()
  }

  it('asks the server to take over the icon and colour, and the name when none was typed', async () => {
    const { api, container } = await start()
    await create(container, '')
    await waitFor(() => api.find('POST', '/sites/site_new/sync/apply')[0] ?? null)
    expect(api.find('POST', '/sites/site_new/sync/apply')[0]?.body).toEqual({ fields: ['name', 'icon', 'color'] })
  })

  it('leaves a typed name alone, and still adds the site when the page cannot be read', async () => {
    const { api, container } = await start()
    api.state.syncFails = true
    await create(container, 'My shop')
    await waitFor(() => api.find('POST', '/sites/site_new/sync/apply')[0] ?? null)
    expect(api.find('POST', '/sites/site_new/sync/apply')[0]?.body).toEqual({ fields: ['icon', 'color'] })
    expect(api.state.sites).toHaveLength(1)
    expect(container.querySelector('.analytik-site-form')).toBeNull()
  })
})
