/** Dialect-neutral helpers for building and running SQL text. */

/** Drivers reject `undefined` and some reject booleans; columns store flags as 0/1. */
export function normalizeParams(params: readonly unknown[] = []): unknown[] {
  return params.map((value) => {
    if (value === undefined) return null
    if (typeof value === 'boolean') return value ? 1 : 0
    return value
  })
}

/** Rewrites `?` placeholders to `$1, $2, ...`, leaving quoted strings and identifiers alone. */
export function toNumberedPlaceholders(sql: string): string {
  let out = ''
  let index = 0
  let quote: string | null = null
  for (const char of sql) {
    if (quote) {
      if (char === quote) quote = null
    } else if (char === "'" || char === '"') {
      quote = char
    } else if (char === '?') {
      out += `$${++index}`
      continue
    }
    out += char
  }
  return out
}

/** Splits a migration file into statements. Migrations keep semicolons out of string literals. */
export function splitStatements(sql: string): string[] {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*(?:\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean)
}

/** `?, ?, ?` for an IN list. */
export function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ')
}
