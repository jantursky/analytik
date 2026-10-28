import { describe, expect, it } from 'vitest'

import type { TimeseriesPoint } from '../src/shared/types'
import { comparisonIsEmpty } from '../src/dashboard/views/ComparisonNote'
import { timeseries } from './dashboard-fixtures'

const zero = { visitors: 0, sessions: 0, pageviews: 0, revenue: 0, orders: 0 }

describe('comparisonIsEmpty', () => {
  it('is true only when a comparison came back and recorded nothing', () => {
    expect(comparisonIsEmpty(timeseries)).toBe(false)
    const empty: TimeseriesPoint[] = timeseries.map((point) => ({ ...point, previous: { ...point, ...zero } }))
    expect(comparisonIsEmpty(empty)).toBe(true)
    const some = empty.map((point, i) => (i === 1 ? { ...point, previous: { ...point, ...zero, visitors: 3 } } : point))
    expect(comparisonIsEmpty(some)).toBe(false)
  })
})
