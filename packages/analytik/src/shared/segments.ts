import { DIMENSIONS } from './dimensions'
import type { Filters } from './types'

/** A named set of filters an admin saved to apply again with one click. */
export interface Segment {
  id: string
  name: string
  filters: Filters
}

export const MAX_SEGMENTS = 20
export const MAX_SEGMENT_NAME = 60
const MAX_VALUE = 500

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The saved segments in `value` that are well formed, up to the limit; anything else is dropped. Filters on a
 * dimension that no longer exists are left out, so a segment saved by another version still applies.
 */
export function parseSegments(value: unknown): Segment[] {
  if (!Array.isArray(value)) return []
  const segments: Segment[] = []
  for (const item of value as unknown[]) {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.name !== 'string' || !isRecord(item.filters))
      continue
    const filters: Filters = {}
    for (const [dimension, filter] of Object.entries(item.filters)) {
      if ((DIMENSIONS as readonly string[]).includes(dimension) && typeof filter === 'string') {
        filters[dimension] = filter.slice(0, MAX_VALUE)
      }
    }
    segments.push({ id: item.id.slice(0, 32), name: item.name.trim().slice(0, MAX_SEGMENT_NAME), filters })
    if (segments.length === MAX_SEGMENTS) break
  }
  return segments
}

/** Why `value` can't be stored as `segments`, or `null` when it can. Stricter than `parseSegments`, which forgives. */
export function segmentsProblem(value: unknown): string | null {
  if (value === undefined) return null
  if (!Array.isArray(value)) return 'segments must be a list'
  if (value.length > MAX_SEGMENTS) return `at most ${MAX_SEGMENTS} segments`
  for (const item of value as unknown[]) {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id || item.id.length > 32)
      return 'a segment needs an id'
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > MAX_SEGMENT_NAME) {
      return `a segment name is 1 to ${MAX_SEGMENT_NAME} characters`
    }
    if (!isRecord(item.filters) || Object.keys(item.filters).length > DIMENSIONS.length) {
      return 'a segment needs its filters'
    }
    for (const filter of Object.values(item.filters)) {
      if (typeof filter !== 'string' || filter.length > MAX_VALUE)
        return 'a filter value is a string up to 500 characters'
    }
  }
  return null
}
