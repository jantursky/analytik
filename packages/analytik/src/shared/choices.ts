/** The period, comparison, breakdown tabs and table columns an admin picked, kept in the dashboard preferences. */

export const MAX_TABS = 30
export const MAX_TABLES = 20
export const MAX_COLUMNS = 40
const MAX_KEY = 40
const PERIODS = ['today', '24h', '7d', '30d', '90d', '12m']
const INTERVALS = ['hour', 'day', 'week', 'month']
const COMPARISONS = ['previous', 'year']

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The remembered tab of each breakdown card, by the card's dimensions joined with commas; the rest is dropped. */
export function parseTabs(value: unknown): Record<string, string> {
  const tabs: Record<string, string> = {}
  if (!isRecord(value)) return tabs
  for (const [card, tab] of Object.entries(value)) {
    if (typeof tab === 'string' && card.length <= 100 && tab.length <= 32) tabs[card] = tab
    if (Object.keys(tabs).length === MAX_TABS) break
  }
  return tabs
}

/** Why the remembered choices can't be stored, or `null` when they can. Stricter than the parsers, which forgive. */
export function choicesProblem(values: Record<string, unknown>): string | null {
  const { period, interval, compare, tabs } = values
  const columns = columnsProblem(values.columns)
  if (columns) return columns
  if (period !== undefined && !PERIODS.includes(period as string)) return 'period must be a preset such as 7d'
  if (interval !== undefined && !INTERVALS.includes(interval as string))
    return 'interval must be hour, day, week or month'
  if (compare !== undefined && !COMPARISONS.includes(compare as string)) return 'compare must be previous or year'
  if (tabs !== undefined) {
    if (!isRecord(tabs) || Object.keys(tabs).length > MAX_TABS) return `tabs must hold at most ${MAX_TABS} cards`
    for (const [card, tab] of Object.entries(tabs)) {
      if (card.length > 100 || typeof tab !== 'string' || tab.length > 32) return 'a remembered tab is a short string'
    }
  }
  return null
}

/** The order of a table's columns and which of them are hidden; columns the saved list lacks are shown last. */
export interface ColumnChoice {
  order: string[]
  hidden: string[]
}

const keys = (value: unknown): string[] =>
  Array.isArray(value)
    ? (value as unknown[])
        .filter((key): key is string => typeof key === 'string' && key.length <= MAX_KEY)
        .slice(0, MAX_COLUMNS)
    : []

/** What was saved for one table; anything malformed is dropped. */
export function parseColumns(value: unknown, table: string): ColumnChoice | undefined {
  const saved = isRecord(value) ? value[table] : undefined
  if (!isRecord(saved)) return undefined
  return { order: keys(saved.order), hidden: keys(saved.hidden) }
}

/** Why the saved table columns can't be stored, or `null` when they can. */
export function columnsProblem(value: unknown): string | null {
  if (value === undefined) return null
  if (!isRecord(value) || Object.keys(value).length > MAX_TABLES)
    return `columns must hold at most ${MAX_TABLES} tables`
  for (const [table, saved] of Object.entries(value)) {
    if (table.length > MAX_KEY || !isRecord(saved)) return 'the columns of a table are an order and a hidden list'
    for (const list of [saved.order, saved.hidden]) {
      if (
        !Array.isArray(list) ||
        list.length > MAX_COLUMNS ||
        !list.every((key) => typeof key === 'string' && key.length <= MAX_KEY)
      ) {
        return `a table has at most ${MAX_COLUMNS} columns, named by short strings`
      }
    }
  }
  return null
}
