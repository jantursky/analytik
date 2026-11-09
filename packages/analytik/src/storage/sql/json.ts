import type { Dialect } from '../types'

/** SQL text with its own bound parameters. */
export interface SqlPart {
  sql: string
  params: unknown[]
}

/**
 * The text of property `key` in a JSON column (`events.props`), `NULL` when the key is missing or null. Booleans read
 * `true` or `false` and numbers as written, on every storage. The key is always a bound parameter, and callers
 * check it against `PROP_KEY` first.
 */
export function jsonText(column: string, key: string, dialect: Dialect): SqlPart {
  if (dialect === 'postgres') return { sql: `(${column}::jsonb ->> ?)`, params: [key] }
  const path = `$."${key}"`
  return {
    sql: `(CASE json_type(${column}, ?) WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' ELSE CAST(json_extract(${column}, ?) AS TEXT) END)`,
    params: [path, path],
  }
}

/** The pieces of a query that lists the keys of a JSON object column: the `FROM` item, and conditions on its rows. */
export function jsonEach(column: string, dialect: Dialect): { from: string; usable: string } {
  if (dialect === 'postgres') {
    return {
      from: `jsonb_each(${column}::jsonb) AS j(key, value)`,
      // Keys the report accepts, and values that are not null.
      usable: `j.value <> 'null'::jsonb AND j.key ~ '^[A-Za-z0-9_.-]{1,64}$'`,
    }
  }
  return {
    from: `json_each(${column}) AS j`,
    usable: `j.type <> 'null' AND length(j.key) BETWEEN 1 AND 64 AND j.key NOT GLOB '*[^A-Za-z0-9_.-]*'`,
  }
}
