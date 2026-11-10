/** The part of the diagram in view, in diagram units. It keeps the aspect ratio of the whole diagram. */
export interface Viewport {
  x: number
  y: number
  w: number
  h: number
}

export const MAX_ZOOM = 8
export const ZOOM_STEP = 1.5

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max)

/** Keeps the view inside the whole diagram. */
export function fit(view: Viewport, whole: Viewport): Viewport {
  const w = clamp(view.w, whole.w / MAX_ZOOM, whole.w)
  const h = (w * whole.h) / whole.w
  return {
    x: clamp(view.x, whole.x, whole.x + whole.w - w),
    y: clamp(view.y, whole.y, whole.y + whole.h - h),
    w,
    h,
  }
}

/** How far in the view is: 1 shows the whole diagram. */
export const zoomLevel = (view: Viewport, whole: Viewport): number => whole.w / view.w

/** Zooms by `factor` (above 1 closer), keeping the diagram point (`px`, `py`) where it is on screen. */
export function zoomAt(view: Viewport, whole: Viewport, factor: number, px: number, py: number): Viewport {
  const w = clamp(view.w / factor, whole.w / MAX_ZOOM, whole.w)
  const ratio = w / view.w
  return fit({ x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio, w, h: view.h * ratio }, whole)
}

/** Moves the view by (`dx`, `dy`) diagram units. */
export const panBy = (view: Viewport, whole: Viewport, dx: number, dy: number): Viewport =>
  fit({ ...view, x: view.x + dx, y: view.y + dy }, whole)
