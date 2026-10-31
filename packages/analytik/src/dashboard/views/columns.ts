import type { ColumnChoice } from '../../shared/choices'
import type { Column } from './DataTable'

export interface ArrangedColumn<T> {
  column: Column<T>
  shown: boolean
}

/**
 * The table's columns in the saved order, each marked shown or hidden. Columns the saved choice does not know (added
 * by a later version) come last and are shown; columns it names that no longer exist are dropped. A choice that hides
 * everything shows everything, so the table never ends up with no columns.
 */
export function arrangeColumns<T>(columns: readonly Column<T>[], saved: ColumnChoice | undefined): ArrangedColumn<T>[] {
  const byKey = new Map(columns.map((column) => [column.key, column]))
  const order = [...new Set([...(saved?.order ?? []).filter((key) => byKey.has(key)), ...byKey.keys()])]
  const hidden = new Set(saved?.hidden)
  const arranged = order.flatMap((key) => {
    const column = byKey.get(key)
    return column ? [{ column, shown: !hidden.has(key) }] : []
  })
  return arranged.some((item) => item.shown) ? arranged : arranged.map(({ column }) => ({ column, shown: true }))
}

/** The choice that gives `arranged` back, or undefined when it is the default one (so nothing is stored). */
export function columnChoice<T>(
  arranged: readonly ArrangedColumn<T>[],
  defaults: readonly Column<T>[],
): ColumnChoice | undefined {
  const order = arranged.map((item) => item.column.key)
  const hidden = arranged.filter((item) => !item.shown).map((item) => item.column.key)
  const sameOrder = order.every((key, index) => key === defaults[index]?.key)
  return sameOrder && hidden.length === 0 ? undefined : { order, hidden }
}
