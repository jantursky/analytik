import { isPropKey } from '../../shared/dimensions'
import type { PropertiesResult } from '../../shared/types'
import { jsonEach, jsonText } from '../../storage/sql/json'
import { placeholders } from '../../storage/sql/statements'
import { AnalytikError, type Context } from '../context'
import type { SiteRecord } from '../sites'
import { type StatsQuery, filterSql } from './query'

export const MAX_KEYS = 20
export const MAX_VALUES = 50

interface Options {
  /** The goal whose events are read. */
  name: string
  /** Lists the values of this key; without it, the keys. */
  key?: string
}

/**
 * The custom properties of one goal's events in the range: its keys with event counts, or the values of one key
 * with visitors and events (at most 50, the rest as `other`). Goal events only, so sign-in properties are never read.
 */
export async function properties(
  ctx: Context,
  site: SiteRecord,
  query: StatsQuery,
  { name, key }: Options,
): Promise<PropertiesResult> {
  if (!name) throw new AnalytikError('name (the goal) is required')
  if (key !== undefined && !isPropKey(key)) throw new AnalytikError('key must be 1 to 64 letters, digits, _ . or -')
  const filters = filterSql(query.filters, query.dialect)
  const from = 'FROM events e JOIN sessions s ON s.site_id = e.site_id AND s.id = e.session_id'
  const where = `WHERE e.site_id = ? AND e.type = 'goal' AND e.name = ? AND e.ts >= ? AND e.ts < ? AND e.props IS NOT NULL${filters.sql}`
  const base = `${from} ${where}`
  const params = [site.id, name, query.from, query.to, ...filters.params]

  if (key === undefined) {
    const each = jsonEach('e.props', query.dialect)
    const keys = await ctx.storage.query<{ key: string; events: number }>(
      `SELECT j.key AS key, COUNT(*) AS events ${from}, ${each.from} ${where} AND ${each.usable}
       GROUP BY j.key ORDER BY events DESC, j.key LIMIT ${MAX_KEYS}`,
      params,
    )
    return { name, key: null, keys, values: [], other: null }
  }

  const value = jsonText('e.props', key, query.dialect)
  const rows = `(SELECT ${value.sql} AS value, e.visitor_id ${base}) t`
  const rowParams = [...value.params, ...params]
  const [values, [total]] = await Promise.all([
    ctx.storage.query<{ value: string; visitors: number; events: number }>(
      `SELECT value, COUNT(DISTINCT visitor_id) AS visitors, COUNT(*) AS events FROM ${rows}
       WHERE value IS NOT NULL GROUP BY value ORDER BY events DESC, value LIMIT ${MAX_VALUES}`,
      rowParams,
    ),
    ctx.storage.query<{ events: number }>(`SELECT COUNT(*) AS events FROM ${rows} WHERE value IS NOT NULL`, rowParams),
  ])
  const left = (total?.events ?? 0) - values.reduce((sum, row) => sum + row.events, 0)
  let other: PropertiesResult['other'] = null
  if (left > 0) {
    const [rest] = await ctx.storage.query<{ visitors: number }>(
      `SELECT COUNT(DISTINCT visitor_id) AS visitors FROM ${rows}
       WHERE value IS NOT NULL AND value NOT IN (${placeholders(values.length)})`,
      [...rowParams, ...values.map((row) => row.value)],
    )
    other = { visitors: rest?.visitors ?? 0, events: left }
  }
  return { name, key, keys: [], values, other }
}
