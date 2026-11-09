import { MINUTE } from '../shared/time'

/** Entries kept at most; a flood of spoofed addresses must not grow memory without limit. */
export const LIMIT_ENTRIES = 10_000

interface Window {
  start: number
  count: number
}

/** A fixed-window counter held in memory: no storage write per request. */
export interface IngestLimiter {
  /** Counts one request. Returns the seconds to wait when the limit is passed, otherwise null. */
  hit(key: string, limit: number, now: number): number | null
  readonly size: number
}

export function createIngestLimiter(): IngestLimiter {
  const windows = new Map<string, Window>()

  const sweep = (now: number) => {
    for (const [key, entry] of windows) if (now - entry.start >= MINUTE) windows.delete(key)
  }

  return {
    get size() {
      return windows.size
    },
    hit(key, limit, now) {
      let entry = windows.get(key)
      if (!entry || now - entry.start >= MINUTE) {
        if (!entry && windows.size >= LIMIT_ENTRIES) {
          sweep(now)
          // Still full: drop the oldest entry (Map keeps insertion order) so the newest client is counted.
          if (windows.size >= LIMIT_ENTRIES) {
            for (const oldest of windows.keys()) {
              windows.delete(oldest)
              break
            }
          }
        }
        windows.delete(key)
        entry = { start: now, count: 0 }
        windows.set(key, entry)
      }
      entry.count += 1
      if (entry.count <= limit) return null
      return Math.max(1, Math.ceil((entry.start + MINUTE - now) / 1000))
    },
  }
}
