/** A row of any export: a CSV record or a JSON object. */
export type SourceRow = Record<string, unknown>

/** Column names compared case-insensitively and without underscores, so `url_path` and `urlPath` are the same. */
export const norm = (name: string): string => name.toLowerCase().replace(/[_\s]/g, '')

export class Row {
  private readonly values = new Map<string, unknown>()

  constructor(raw: SourceRow) {
    for (const [key, value] of Object.entries(raw)) this.values.set(norm(key), value)
  }

  has(name: string): boolean {
    return this.values.has(norm(name))
  }

  /** Trimmed text, or null when the column is missing or empty. */
  text(name: string): string | null {
    const value = this.values.get(norm(name))
    if (value === null || value === undefined) return null
    const text = (
      typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : ''
    ).trim()
    return text === '' || text.toLowerCase() === 'null' ? null : text
  }
}

/** The names in `required` that no column provides, compared the way `Row` compares them. */
export function missingColumns(columns: readonly string[], required: readonly string[]): string[] {
  const present = new Set(columns.map(norm))
  return required.filter((name) => !present.has(norm(name)))
}
