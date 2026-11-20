import { describe, expect, it } from 'vitest'

import { parseStartView, parseViews, SITE_VIEWS } from '../src/dashboard/preferences'

describe('parseViews', () => {
  it('shows every view, in the default order, when nothing is saved', () => {
    expect(parseViews(undefined)).toEqual([...SITE_VIEWS])
    expect(parseViews('sessions')).toEqual([...SITE_VIEWS])
    expect(parseViews({})).toEqual([...SITE_VIEWS])
  })

  it('keeps a saved list in its order and hides what it leaves out', () => {
    expect(parseViews(['sessions', 'overview', 'pages'])).toEqual(['sessions', 'overview', 'pages'])
  })

  it('drops unknown and repeated names', () => {
    expect(parseViews(['pages', 'nope', 3, 'pages', null, 'events'])).toEqual(['pages', 'events'])
  })

  it('falls back to the default when nothing valid is left', () => {
    expect(parseViews([])).toEqual([...SITE_VIEWS])
    expect(parseViews(['settings', 'sites'])).toEqual([...SITE_VIEWS])
  })
})

describe('parseStartView', () => {
  const visible = parseViews(['sessions', 'overview', 'pages'])

  it('opens Overview when nothing is saved and Overview is visible, wherever it stands', () => {
    expect(parseStartView(undefined, visible)).toBe('overview')
  })

  it('opens the saved view while it is visible', () => {
    expect(parseStartView('pages', visible)).toBe('pages')
  })

  it('opens the first visible view when the wanted one is hidden or unknown', () => {
    expect(parseStartView('bots', visible)).toBe('sessions')
    expect(parseStartView('nope', visible)).toBe('overview')
    expect(parseStartView(undefined, ['events', 'pages'])).toBe('events')
  })
})
