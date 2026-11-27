import { describe, expect, it } from 'vitest'

import { neverHadEvents } from '../src/dashboard/first-run'
import type { Overview } from '../src/shared/types'

const delta = (value: number) => ({ value, previous: 0, change: null })
const overview = (counts: Partial<Record<'visitors' | 'pageviews' | 'orders', number>>): Overview =>
  ({
    visitors: delta(counts.visitors ?? 0),
    pageviews: delta(counts.pageviews ?? 0),
    orders: delta(counts.orders ?? 0),
  }) as Overview

describe('neverHadEvents', () => {
  it('is true for a site with nothing at all, over all time', () => {
    expect(neverHadEvents(overview({}))).toBe(true)
  })

  it('is false when older events exist, even if the chosen range is quiet', () => {
    expect(neverHadEvents(overview({ visitors: 3, pageviews: 5 }))).toBe(false)
  })

  it('is false for a site that only has payments', () => {
    expect(neverHadEvents(overview({ orders: 1 }))).toBe(false)
  })
})
