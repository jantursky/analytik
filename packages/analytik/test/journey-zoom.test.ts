import { describe, expect, it } from 'vitest'

import { MAX_ZOOM, fit, panBy, zoomAt, zoomLevel } from '../src/dashboard/views/journey-zoom'

const whole = { x: 0, y: -22, w: 800, h: 400 }

describe('journey zoom', () => {
  it('keeps the point under the pointer where it is', () => {
    const view = zoomAt(whole, whole, 2, 600, 100)
    expect(view.w).toBe(400)
    expect(view.h).toBe(200)
    expect((600 - view.x) / view.w).toBeCloseTo((600 - whole.x) / whole.w)
    expect((100 - view.y) / view.h).toBeCloseTo((100 - whole.y) / whole.h)
  })

  it('stops at the whole diagram and at the closest zoom', () => {
    expect(zoomAt(whole, whole, 0.5, 400, 100)).toEqual(whole)
    const closest = zoomAt(whole, whole, 1000, 400, 100)
    expect(zoomLevel(closest, whole)).toBe(MAX_ZOOM)
    expect(closest.h / closest.w).toBeCloseTo(whole.h / whole.w)
  })

  it('moves the view but not out of the diagram', () => {
    const zoomed = { x: 100, y: 0, w: 400, h: 200 }
    expect(panBy(zoomed, whole, 50, 20)).toEqual({ x: 150, y: 20, w: 400, h: 200 })
    expect(panBy(zoomed, whole, -500, -500)).toEqual({ x: 0, y: -22, w: 400, h: 200 })
    expect(panBy(zoomed, whole, 900, 900)).toEqual({ x: 400, y: 178, w: 400, h: 200 })
  })

  it('pulls a view that is too wide back to the whole diagram', () => {
    expect(fit({ x: 50, y: 50, w: 5000, h: 100 }, whole)).toEqual(whole)
  })
})
