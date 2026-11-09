import { describe, expect, it } from 'vitest'

import { readAddress, writeAddress } from '../src/dashboard/address'
import { presetRange } from '../src/dashboard/range'
import { isFilterKey, isPropKey } from '../src/shared/dimensions'
import { parseSegments, segmentsProblem } from '../src/shared/segments'
import { jsonEach, jsonText } from '../src/storage/sql/json'

describe('property keys', () => {
  it('accept 1 to 64 letters, digits, _ . and -', () => {
    for (const key of ['plan', 'a', 'Plan_2.x-y', 'x'.repeat(64)]) expect(isPropKey(key), key).toBe(true)
    for (const key of ['', 'a"b', "a'b", 'with space', 'a/b', '$x', 'x'.repeat(65), 'é']) {
      expect(isPropKey(key), key).toBe(false)
    }
  })

  it('make a filter key only after prop:, next to the dimensions', () => {
    expect(isFilterKey('country')).toBe(true)
    expect(isFilterKey('prop:plan')).toBe(true)
    expect(isFilterKey('prop:')).toBe(false)
    expect(isFilterKey('prop:a"b')).toBe(false)
    expect(isFilterKey('plan')).toBe(false)
  })
})

describe('reading inside JSON', () => {
  it('builds SQLite text with the key as a bound path, and booleans as words', () => {
    const part = jsonText('e.props', 'plan', 'sqlite')
    expect(part.sql).toContain("json_type(e.props, ?) WHEN 'true' THEN 'true'")
    expect(part.sql).toContain('json_extract(e.props, ?)')
    expect(part.sql).not.toContain('plan')
    expect(part.params).toEqual(['$."plan"', '$."plan"'])
    expect(jsonText('e.props', 'plan', 'memory').params).toEqual(['$."plan"', '$."plan"'])
  })

  it('builds Postgres text with the key as a bound parameter', () => {
    const part = jsonText('e.props', 'plan', 'postgres')
    expect(part).toEqual({ sql: '(e.props::jsonb ->> ?)', params: ['plan'] })
  })

  it('lists keys with each storage’s own function and only usable keys', () => {
    expect(jsonEach('e.props', 'sqlite').from).toBe('json_each(e.props) AS j')
    expect(jsonEach('e.props', 'sqlite').usable).toContain("j.type <> 'null'")
    expect(jsonEach('e.props', 'postgres').from).toBe('jsonb_each(e.props::jsonb) AS j(key, value)')
    expect(jsonEach('e.props', 'postgres').usable).toContain("j.key ~ '^[A-Za-z0-9_.-]{1,64}$'")
  })
})

describe('property filters in the address and saved segments', () => {
  const vocabulary = { views: ['overview', 'events'], tabs: [] }
  const now = new Date('2026-10-15T12:00:00').getTime()
  const base = new URL('http://localhost/dash')

  it('round-trips through the address', () => {
    const range = presetRange('7d', now)
    const url = writeAddress(base, { site: 's1', range, filters: { goal: 'signup', 'prop:plan': 'pro' } })
    expect(url.searchParams.get('f.prop:plan')).toBe('pro')
    expect(readAddress(url.search, vocabulary, now).filters).toEqual({ goal: 'signup', 'prop:plan': 'pro' })
  })

  it('leaves out a property key the server would refuse', () => {
    expect(readAddress('?f.prop:a%22b=x&f.prop:plan=pro', vocabulary, now).filters).toEqual({ 'prop:plan': 'pro' })
  })

  it('are kept by saved segments', () => {
    const saved = [{ id: 'a', name: 'Pro signups', filters: { goal: 'signup', 'prop:plan': 'pro', 'prop:a"b': 'x' } }]
    expect(parseSegments(saved)).toEqual([
      { id: 'a', name: 'Pro signups', filters: { goal: 'signup', 'prop:plan': 'pro' } },
    ])
    expect(segmentsProblem([{ ...saved[0], filters: { goal: 'signup', 'prop:plan': 'pro' } }])).toBeNull()
  })
})
