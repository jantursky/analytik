import { afterEach, describe, expect, it, vi } from 'vitest'

import { Dashboard, type DashboardView } from '../src/dashboard/index'
import { fakeApi, site } from './dashboard-fixtures'
import { choose, waitFor } from './dashboard-helpers'
import { byLabel, byText, click, fill, render, settled, submit } from './react-render'

const withTargets = (targets = [{ goal: 'signup', target: 1000, period: 'month' as const }]) => {
  const api = fakeApi()
  // Replaces the stored site, as a save in Settings would, so a reload shows the targets.
  api.state.sites = api.state.sites.map((s) => (s.id === site.id ? { ...s, targets } : s))
  return api
}

async function open(api = fakeApi(), view?: DashboardView, extra: { share?: string } = {}) {
  const result = await render(<Dashboard api="/api" fetcher={api.fetcher} siteId="site_1" view={view} {...extra} />)
  await settled()
  return { ...result, api }
}

const targets = (container: Element) => [...container.querySelectorAll('.analytik-target')]

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('goal targets on the overview', () => {
  it('show progress above the goal breakdown: count, share, bar and an estimate', async () => {
    const { container, api } = await open(withTargets(), 'overview')
    const [first] = await waitFor(() => (targets(container).length ? targets(container) : null))
    expect(first?.querySelector('.analytik-target-name')?.textContent).toBe('signup')
    expect(first?.textContent).toContain('This month')
    expect(first?.textContent).toContain('300 of 1,000')
    expect(first?.textContent).toContain('30%')
    expect(first?.textContent).toContain('On pace for about 600 (an estimate)')
    const bar = first?.querySelector('[role="progressbar"]')
    expect(bar?.getAttribute('aria-valuenow')).toBe('300')
    expect(bar?.getAttribute('aria-valuemax')).toBe('1000')
    expect(bar?.getAttribute('aria-valuetext')).toBe('300 of 1,000')
    // Progress is read for the target's own period, so the toolbar's range does not change the request.
    expect(api.find('GET', '/sites/site_1/targets')[0]?.params).toEqual({})
    expect(
      container.querySelector('.analytik-target')?.closest('.analytik-card')?.querySelector('.analytik-bars'),
    ).not.toBeNull()
  })

  it('ask for nothing when the site has no targets', async () => {
    const { container, api } = await open(fakeApi(), 'overview')
    await settled()
    expect(targets(container)).toHaveLength(0)
    expect(api.find('GET', '/sites/site_1/targets')).toHaveLength(0)
  })

  it('leave out the estimate while the server has none, and fill the bar once the number is reached', async () => {
    const api = fakeApi({
      'GET /sites/:id/targets': () => ({
        now: 1,
        targets: [
          { goal: 'signup', target: 10, period: 'week', count: 12, start: 0, end: 2, projection: null },
          { goal: 'download', target: 5, period: 'quarter', count: 1, start: 0, end: 2, projection: null },
        ],
      }),
    })
    api.state.sites = withTargets().state.sites
    const { container } = await open(api, 'overview')
    const [done, quiet] = await waitFor(() => (targets(container).length === 2 ? targets(container) : null))
    expect(done?.textContent).toContain('12 of 10')
    expect(done?.textContent).toContain('120%')
    expect(done?.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('10')
    expect(done?.querySelector('.analytik-target-value')?.hasAttribute('data-reached')).toBe(true)
    expect(quiet?.textContent).toContain('This quarter')
    expect(container.querySelectorAll('.analytik-target-pace')).toHaveLength(0)
  })

  it('stay out of the way when progress cannot be read', async () => {
    const api = fakeApi({ 'GET /sites/:id/targets': () => Response.json({ error: 'boom' }, { status: 500 }) })
    api.state.sites = withTargets().state.sites
    const { container } = await open(api, 'overview')
    await waitFor(() => api.find('GET', '/sites/site_1/targets').length > 0 || null)
    await settled()
    expect(targets(container)).toHaveLength(0)
    expect(container.querySelector('.analytik-bars')).not.toBeNull()
  })

  it('are not shown on a shared dashboard, which has no access to the settings', async () => {
    const api = withTargets()
    const { container } = await open(api, 'overview', { share: 'good-token-1234567890abcdef' })
    await settled()
    expect(targets(container)).toHaveLength(0)
    expect(api.find('GET', '/sites/site_1/targets')).toHaveLength(0)
  })
})

async function section(container: Element, label: string): Promise<void> {
  await click(byText(container, label, '.analytik-settings-nav button'))
  await settled()
}

describe('Settings → Goals', () => {
  it('adds, edits and removes targets and saves only that field', async () => {
    const { container, api } = await open(fakeApi(), 'settings')
    await section(container, 'Goals')
    expect(container.textContent).toContain('No targets yet')

    await click(byText(container, 'Add a target', 'button'))
    await fill(byLabel(container, 'Goal name'), ' signup ')
    await fill(byLabel(container, 'Target'), '1000')
    await click(byText(container, 'Add a target', 'button'))
    const goals = container.querySelectorAll<HTMLInputElement>('.analytik-target-row input[placeholder="signup"]')
    await fill(goals[1], 'download')
    const numbers = container.querySelectorAll<HTMLInputElement>('.analytik-target-row input[type="number"]')
    await fill(numbers[1], '50.7')
    await choose(container.querySelectorAll('.analytik-target-row [role="combobox"]')[1], 'Week')
    await click(byText(container, 'Add a target', 'button'))
    await submit(container.querySelector('form'))
    await settled()

    // The row left without a goal name is dropped, a fractional number is cut to a whole one, names are not trimmed here.
    expect(api.find('PATCH', '/sites/site_1')[0]?.body).toEqual({
      targets: [
        { goal: ' signup ', target: 1000, period: 'month' },
        { goal: 'download', target: 50, period: 'week' },
      ],
    })
    expect(byText(container, 'Settings saved', '[role="status"]')).toBeDefined()

    await click(byText(container, 'Remove', '.analytik-target-row button'))
    await submit(container.querySelector('form'))
    await settled()
    expect((api.find('PATCH', '/sites/site_1')[1]?.body as { targets: unknown[] }).targets).toHaveLength(1)
  })

  it('stops adding at twenty and shows the server message for a bad target', async () => {
    const api = fakeApi({
      'PATCH /sites/:id': () =>
        Response.json({ error: 'a target must be a whole number from 1 to 1,000,000,000' }, { status: 400 }),
    })
    const { container } = await open(api, 'settings')
    await section(container, 'Goals')
    const add = () => byText(container, 'Add a target', 'button') as HTMLButtonElement
    for (let i = 0; i < 20; i++) await click(add())
    expect(container.querySelectorAll('.analytik-target-row')).toHaveLength(20)
    expect(add().disabled).toBe(true)
    await fill(container.querySelector('.analytik-target-row input'), 'signup')
    await submit(container.querySelector('form'))
    await settled()
    expect(container.querySelector('.analytik-notice')?.textContent).toContain('a target must be a whole number')
  })

  it('shows the targets already saved', async () => {
    const { container } = await open(withTargets(), 'settings')
    await section(container, 'Goals')
    expect(container.querySelectorAll('.analytik-target-row')).toHaveLength(1)
    expect(container.querySelector<HTMLInputElement>('.analytik-target-row input')?.value).toBe('signup')
    expect(container.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe('1000')
  })
})
