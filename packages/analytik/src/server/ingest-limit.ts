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
  /** Counts one request and returns how many there were in the window, this one included, and when it ends. */
  count(key: string, now: number): { count: number; resetsAt: number }
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
    count(key, now) {
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
      return { count: entry.count, resetsAt: entry.start + MINUTE }
    },
    hit(key, limit, now) {
      const { count, resetsAt } = this.count(key, now)
      return count <= limit ? null : Math.max(1, Math.ceil((resetsAt - now) / 1000))
    },
  }
}
