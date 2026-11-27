import { afterEach, describe, expect, it } from 'vitest'

import { Dashboard } from '../src/dashboard/index'
import { fakeApi, overview } from './dashboard-fixtures'
import { waitFor } from './dashboard-helpers'
import { byText, click, key, render, settled } from './react-render'

afterEach(() => {
  history.replaceState(null, '', '/')
  localStorage.clear()
})

const zero = { value: 0, previous: 0, change: null }
const none = { ...overview, visitors: zero, sessions: zero, pageviews: zero, orders: zero, revenue: zero, online: 0 }
const allTime = (from: string): boolean => from.startsWith('1970')

async function open(api: ReturnType<typeof fakeApi>) {
  const result = await render(<Dashboard api="/api" fetcher={api.fetcher} siteId="site_1" />)
  await settled()
  return { ...result, api }
}

describe('the first run', () => {
  it('shows the tracking code instead of empty charts on a site that never had an event', async () => {
    const { container } = await open(fakeApi({ 'GET /sites/:id/overview': () => none }))
    await waitFor(() => byText(container, 'No data yet'))
    expect(container.querySelector('.analytik-code')?.textContent).toContain('data-site="site_1"')
    expect(container.querySelector('.analytik-board')).toBeNull()
  })

  it('opens the tracking code settings from the card', async () => {
    const { container } = await open(fakeApi({ 'GET /sites/:id/overview': () => none }))
    await click(await waitFor(() => byText(container, 'Let your coding assistant add it')))
    await settled()
    await waitFor(() => byText(container, 'Site integration prompt'))
  })

  it('shows the normal view on a quiet range of a site with older events', async () => {
    const api = fakeApi({
      'GET /sites/:id/overview': ({ params }) => (allTime(params.from ?? '') ? overview : none),
    })
    const { container } = await open(api)
    await waitFor(() => container.querySelector('.analytik-board'))
    expect(byText(container, 'No data yet')).toBeUndefined()
  })
})

describe('retrying a failed load', () => {
  it('loads the view again, and says so', async () => {
    let failing = true
    const api = fakeApi({
      'GET /sites/:id/breakdown': () =>
        failing ? Response.json({ error: 'server is down' }, { status: 500 }) : [{ value: 'a', visitors: 1 }],
    })
    const { container } = await open(api)
    const retry = await waitFor(() => byText(container, 'Retry', 'button'))
    failing = false
    await click(retry)
    await settled()
    await waitFor(() => container.querySelector('.analytik-sr-only[role="status"]'))
    expect(container.textContent).toContain('Loaded again')
  })
})

describe('metric help', () => {
  it('opens a definition from the keyboard', async () => {
    const { container } = await open(fakeApi())
    const button = await waitFor(() =>
      container.querySelector<HTMLElement>('button[aria-label="What is Bounce rate?"]'),
    )
    await key(button, 'Enter')
    await click(button)
    await waitFor(() => document.body.textContent.includes('Share of visits that viewed one page'))
    expect(button.closest('.analytik-stat-wrap')?.querySelector('.analytik-stat')?.tagName).toBe('BUTTON')
    expect(button.closest('button.analytik-stat')).toBeNull()
  })
})
