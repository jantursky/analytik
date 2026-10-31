import { describe, expect, it } from 'vitest'

import { choicesProblem, MAX_TABS, parseTabs } from '../src/shared/choices'

describe('parseTabs', () => {
  it('keeps short string tabs and drops anything else', () => {
    expect(parseTabs({ 'page,entry': 'entry', bad: 5, long: 'x'.repeat(33) })).toEqual({ 'page,entry': 'entry' })
    expect(parseTabs(undefined)).toEqual({})
    expect(parseTabs([1, 2])).toEqual({})
    expect(parseTabs('page')).toEqual({})
  })

  it('stops at the limit', () => {
    const many = Object.fromEntries(Array.from({ length: MAX_TABS + 5 }, (_, n) => [`c${n}`, 'page']))
    expect(Object.keys(parseTabs(many))).toHaveLength(MAX_TABS)
  })
})

describe('choicesProblem', () => {
  it('accepts nothing, and known values', () => {
    expect(choicesProblem({})).toBeNull()
    expect(choicesProblem({ period: '12m', interval: 'month', compare: 'previous', tabs: {} })).toBeNull()
  })

  it('names the first thing that is wrong', () => {
    expect(choicesProblem({ period: 'custom' })).toMatch(/period/)
    expect(choicesProblem({ interval: 'year' })).toMatch(/interval/)
    expect(choicesProblem({ compare: 1 })).toMatch(/compare/)
    expect(choicesProblem({ tabs: 'x' })).toMatch(/tabs/)
    expect(choicesProblem({ tabs: { ['x'.repeat(101)]: 'page' } })).toMatch(/tab/)
  })
})

describe('table columns', () => {
  it('reads one table, and drops what is malformed', async () => {
    const { parseColumns } = await import('../src/shared/choices')
    const saved = { sessions: { order: ['a', 'b', 3, 'c'], hidden: ['b'] }, other: 'x' }
    expect(parseColumns(saved, 'sessions')).toEqual({ order: ['a', 'b', 'c'], hidden: ['b'] })
    expect(parseColumns(saved, 'other')).toBeUndefined()
    expect(parseColumns(saved, 'missing')).toBeUndefined()
    expect(parseColumns('nope', 'sessions')).toBeUndefined()
    expect(parseColumns({ sessions: { order: 'a' } }, 'sessions')).toEqual({ order: [], hidden: [] })
  })

  it('checks what may be stored', async () => {
    const { columnsProblem, choicesProblem } = await import('../src/shared/choices')
    expect(columnsProblem(undefined)).toBeNull()
    expect(columnsProblem({ sessions: { order: ['a'], hidden: [] } })).toBeNull()
    expect(choicesProblem({ columns: { sessions: { order: ['a'], hidden: [] } } })).toBeNull()
    expect(columnsProblem([])).toMatch(/columns/)
    expect(columnsProblem({ sessions: 1 })).toMatch(/order and a hidden list/)
    expect(columnsProblem({ sessions: { order: 'a', hidden: [] } })).toMatch(/at most/)
    expect(columnsProblem({ sessions: { order: [1], hidden: [] } })).toMatch(/at most/)
    expect(columnsProblem({ sessions: { order: Array(41).fill('a'), hidden: [] } })).toMatch(/at most/)
    const tables = Object.fromEntries(Array.from({ length: 21 }, (_, n) => [`t${n}`, { order: [], hidden: [] }]))
    expect(columnsProblem(tables)).toMatch(/at most/)
    expect(choicesProblem({ columns: 5 })).toMatch(/columns/)
  })
})
