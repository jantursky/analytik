import { afterEach, describe, expect, it } from 'vitest'

import { Dashboard, type ChartStyle, type DashboardView } from '../src/dashboard/index'
import { parseChartStyle } from '../src/dashboard/preferences'
import { fakeApi } from './dashboard-fixtures'
import { choose, selectTrigger, waitFor } from './dashboard-helpers'
import { byText, click, render, settled } from './react-render'

const TOKEN = 'good-token-1234567890abcdef'

async function open(
  api = fakeApi(),
  props: { view?: DashboardView; chartStyle?: ChartStyle; share?: string } = { view: 'settings' },
) {
  const result = await render(<Dashboard api="/api" fetcher={api.fetcher} siteId="site_1" {...props} />)
  await settled()
  return { ...result, api }
}
const root = (container: Element) => container.querySelector('.analytik')
const style = (container: Element) => root(container)?.getAttribute('data-chart-style')

afterEach(() => {
  history.replaceState(null, '', '/')
  localStorage.clear()
})

describe('parseChartStyle', () => {
  it('knows the three styles and takes anything else for the default', () => {
    expect(['default', 'dither', 'ascii'].map(parseChartStyle)).toEqual(['default', 'dither', 'ascii'])
    expect([undefined, 'neon', 3, null].map(parseChartStyle)).toEqual(['default', 'default', 'default', 'default'])
  })
})

describe('the chart style', () => {
  it('leaves the markup alone without a choice', async () => {
    const { container } = await open()
    expect(style(container)).toBeNull()
  })

  it('follows the saved choice at once and when Settings changes it', async () => {
    const api = fakeApi()
    api.state.preferences = { chartStyle: 'ascii' }
    const { container } = await open(api)
    expect(style(container)).toBe('ascii')
    await click(byText(container, 'Appearance', '.analytik-settings-nav button'))
    await settled()
    await choose(selectTrigger(container, 'Style'), 'Dither')
    expect(style(container)).toBe('dither')
    await waitFor(
      () =>
        api.find('PUT', '/preferences').some((r) => (r.body as { chartStyle?: string }).chartStyle === 'dither') ||
        null,
      400,
    )
    await choose(selectTrigger(container, 'Style'), 'Default')
    expect(style(container)).toBeNull()
  })

  it('lets the prop win over the saved choice', async () => {
    const api = fakeApi()
    api.state.preferences = { chartStyle: 'ascii' }
    const { container } = await open(api, { view: 'settings', chartStyle: 'dither' })
    expect(style(container)).toBe('dither')
  })

  it('does not follow the admin in a share link, but takes the prop', async () => {
    const api = fakeApi()
    api.state.preferences = { chartStyle: 'ascii' }
    expect(style((await open(api, { share: TOKEN })).container)).toBeNull()
    expect(style((await open(api, { share: TOKEN, chartStyle: 'dither' })).container)).toBe('dither')
  })
})
