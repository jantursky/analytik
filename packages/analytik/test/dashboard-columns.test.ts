import { describe, expect, it } from 'vitest'

import { arrangeColumns, columnChoice } from '../src/dashboard/views/columns'
import type { Column } from '../src/dashboard/views/DataTable'

const columns: Column<string>[] = ['a', 'b', 'c'].map((key) => ({
  key,
  label: key.toUpperCase(),
  render: (row) => row,
}))
const keys = (list: { column: Column<string>; shown: boolean }[]) =>
  list.map((i) => `${i.column.key}${i.shown ? '' : '-'}`)

describe('arrangeColumns', () => {
  it('shows every column in its own order when nothing is saved', () => {
    expect(keys(arrangeColumns(columns, undefined))).toEqual(['a', 'b', 'c'])
  })

  it('applies a saved order and hidden list', () => {
    expect(keys(arrangeColumns(columns, { order: ['c', 'a', 'b'], hidden: ['a'] }))).toEqual(['c', 'a-', 'b'])
  })

  it('puts columns the choice does not know last, and drops names that no longer exist', () => {
    expect(keys(arrangeColumns(columns, { order: ['c', 'gone'], hidden: ['gone'] }))).toEqual(['c', 'a', 'b'])
  })

  it('never ends up with no column', () => {
    expect(keys(arrangeColumns(columns, { order: [], hidden: ['a', 'b', 'c'] }))).toEqual(['a', 'b', 'c'])
  })
})

describe('columnChoice', () => {
  it('is nothing for the default arrangement, so nothing is stored', () => {
    expect(columnChoice(arrangeColumns(columns, undefined), columns)).toBeUndefined()
  })

  it('names the order and the hidden columns otherwise', () => {
    const arranged = arrangeColumns(columns, { order: ['b', 'a', 'c'], hidden: ['c'] })
    expect(columnChoice(arranged, columns)).toEqual({ order: ['b', 'a', 'c'], hidden: ['c'] })
    expect(columnChoice(arrangeColumns(columns, { order: [], hidden: ['b'] }), columns)).toEqual({
      order: ['a', 'b', 'c'],
      hidden: ['b'],
    })
  })
})
