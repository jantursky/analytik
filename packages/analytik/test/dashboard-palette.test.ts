import { describe, expect, it, vi } from 'vitest'

import { buildActions, fuzzyScore, type PaletteControls, search } from '../src/dashboard/palette'

describe('fuzzyScore', () => {
  it('matches every word, best when it starts the text', () => {
    expect(fuzzyScore('rev', 'Go to Revenue')).not.toBeNull()
    expect(fuzzyScore('go rev', 'Go to Revenue')).not.toBeNull()
    expect(fuzzyScore('rev', 'Revenue')).toBeLessThan(fuzzyScore('rev', 'Go to Revenue') ?? 0)
    expect(fuzzyScore('SLOVAKIA', 'Filter: country is Slovakia')).not.toBeNull()
  })

  it('lets a word skip a few letters, but not wander across the text', () => {
    expect(fuzzyScore('rvn', 'Go to Revenue')).not.toBeNull()
    expect(fuzzyScore('seg', 'Switch to Example')).toBeNull()
    expect(fuzzyScore('xyz', 'Go to Revenue')).toBeNull()
    expect(fuzzyScore('rev zzz', 'Go to Revenue')).toBeNull()
  })
})

const controls = (over: Partial<PaletteControls> = {}): PaletteControls => ({
  views: [
    { value: 'overview', label: 'Overview' },
    { value: 'revenue', label: 'Revenue' },
  ],
  go: vi.fn(),
  sites: [
    { id: 's1', name: 'One', domain: 'one.test' },
    { id: 's2', name: 'Two', domain: 'two.test' },
  ] as PaletteControls['sites'],
  siteId: 's1',
  openSite: vi.fn(),
  setRange: vi.fn(),
  live: false,
  setLive: vi.fn(),
  cycleTheme: vi.fn(),
  refresh: vi.fn(),
  compare: undefined,
  setCompare: vi.fn(),
  segments: [{ id: 'g1', name: 'Slovakia', filters: { country: 'SK' } }],
  applySegment: vi.fn(),
  filters: { browser: 'Chrome' },
  clearFilters: vi.fn(),
  addFilter: vi.fn(),
  known: new Map([
    ['country', ['SK', '']],
    ['browser', ['Firefox']],
    ['nonsense', ['x']],
  ]),
  ...over,
})

describe('buildActions', () => {
  it('lists what can be done and leaves out what is already so', () => {
    const ids = buildActions(controls()).map((a) => a.id)
    expect(ids).toContain('go:revenue')
    expect(ids).toContain('site:s2')
    expect(ids).not.toContain('site:s1')
    expect(ids).not.toContain('compare:off')
    expect(ids).toContain('compare:year')
    expect(ids).toContain('clear-filters')
    expect(ids).toContain('filter:country:SK')
    expect(ids).not.toContain('filter:browser:Firefox')
    expect(ids).not.toContain('filter:nonsense:x')
  })

  it('runs each action against the dashboard', () => {
    const c = controls({ live: true })
    for (const action of buildActions(c)) action.run()
    expect(c.go).toHaveBeenCalledWith('revenue')
    expect(c.setRange).toHaveBeenCalled()
    expect(c.openSite).toHaveBeenCalledWith('s2')
    expect(c.setCompare).toHaveBeenCalledWith('previous')
    expect(c.applySegment).toHaveBeenCalledWith(expect.objectContaining({ id: 'g1' }))
    expect(c.clearFilters).toHaveBeenCalled()
    expect(c.addFilter).toHaveBeenCalledWith('country', 'SK')
    expect(c.setLive).toHaveBeenCalledWith(false)
    expect(c.cycleTheme).toHaveBeenCalled()
    expect(c.refresh).toHaveBeenCalled()
  })

  it('offers to turn Live on when it is off', () => {
    const labels = buildActions(controls()).map((a) => a.label)
    expect(labels).toContain('Turn Live on')
  })
})

describe('search', () => {
  const actions = buildActions(controls())

  it('shows only the plain commands before anything is typed', () => {
    const shown = search(actions, '')
    expect(shown.some((a) => a.id.startsWith('filter:'))).toBe(false)
    expect(shown.some((a) => a.id === 'theme')).toBe(true)
  })

  it('ranks the best matches first and reaches filters once typed', () => {
    expect(search(actions, 'revenue')[0]?.id).toBe('go:revenue')
    expect(search(actions, 'slov').map((a) => a.id)).toContain('filter:country:SK')
    expect(search(actions, 'zzzz')).toEqual([])
  })
})
