import { afterEach, describe, expect, it, vi } from 'vitest'

import { Dashboard } from '../src/dashboard/index'
import { fakeApi } from './dashboard-fixtures'
import { waitFor, choose } from './dashboard-helpers'
import { byText, click, render, settled } from './react-render'

async function open(search: string, api = fakeApi()) {
  history.replaceState(null, '', `/${search}`)
  const result = await render(<Dashboard api="/api" fetcher={api.fetcher} siteId="site_1" view="events" urlState />)
  await settled()
  return { ...result, api }
}

const card = (container: Element) =>
  [...container.querySelectorAll('section, .analytik-card')].find((el) =>
    el.querySelector('h2, h3')?.textContent.startsWith('Properties of'),
  )

afterEach(() => {
  history.replaceState(null, '', '/')
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('property report in the Events view', () => {
  it('shows nothing until a goal is filtered', async () => {
    const { container, api } = await open('?site=site_1')
    expect(card(container)).toBeUndefined()
    expect(api.find('GET', '/sites/site_1/properties')).toHaveLength(0)
  })

  it('lists the values of the first key, with the goal and range in the request', async () => {
    const { container, api } = await open('?site=site_1&f.goal=signup')
    const found = await waitFor(() => card(container))
    await waitFor(() => found.querySelector('.analytik-bars li'))
    expect(
      [...found.querySelectorAll('.analytik-bars li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim()),
    ).toEqual([expect.stringContaining('pro'), expect.stringContaining('free')])
    const asked = api.find('GET', '/sites/site_1/properties').map((request) => request.params)
    expect(asked).toContainEqual(expect.objectContaining({ name: 'signup', key: 'plan', goal: 'signup', tz: 'UTC' }))
  })

  it('adds the property filter when a value is clicked', async () => {
    const { container } = await open('?site=site_1&f.goal=signup')
    const found = await waitFor(() => card(container))
    await waitFor(() => found.querySelector('.analytik-bars li'))
    await click(byText(found, 'pro'))
    await settled()
    expect(location.search).toContain('f.prop%3Aplan=pro')
  })

  it('switches key and shows the values beyond the cap as one Other row that does not filter', async () => {
    const { container } = await open('?site=site_1&f.goal=signup')
    const found = await waitFor(() => card(container))
    await waitFor(() => found.querySelector('.analytik-bars li'))
    await choose(found.querySelector('[role="combobox"], button[aria-haspopup]'), 'seats')
    await settled()
    await waitFor(() => found.textContent.includes('Other'))
    expect(found.textContent).toContain('Other')
    await click(byText(found, 'Other'))
    await settled()
    expect(location.search).not.toContain('prop')
  })

  it('says so when the goal has no properties', async () => {
    const api = fakeApi({
      'GET /sites/:id/properties': () => ({ name: 'signup', key: null, keys: [], values: [], other: null }),
    })
    const { container } = await open('?site=site_1&f.goal=signup', api)
    const found = await waitFor(() => card(container))
    await waitFor(() => found.textContent.includes('Nothing recorded in this period'))
    expect(found.textContent).toContain('Nothing recorded in this period')
  })
})
