/** Helpers for reading untrusted webhook JSON. */

export interface WebhookRequest {
  headers: Headers
  /** The raw request body, exactly as received; signatures cover these bytes. */
  body: string
  secret: string
  /** Unix ms, for the replay window. Defaults to now. */
  now?: number
}

/** Signed webhooks older or newer than this are rejected as replays. */
export const TOLERANCE_SECONDS = 5 * 60

export type Json = Record<string, unknown>

export const object = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {}

export const string = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : typeof value === 'number' ? String(value) : undefined

export const number = (value: unknown): number | undefined => {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : undefined
}

// Dodo checkout links pass `metadata_*` query params, which some integrations forward with the prefix kept.
const VISITOR_KEYS = ['analytik_visitor_id', 'metadata_analytik_visitor_id', 'visitor_id']
const SESSION_KEYS = ['analytik_session_id', 'metadata_analytik_session_id', 'session_id']

function pick(metadata: Json, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = string(metadata[key])
    if (value) return value
  }
  return undefined
}

/** Visitor and session ids from checkout metadata (the keys `analytik.attribution()` returns). */
export function attributionFrom(metadata: Json): { visitorId?: string; sessionId?: string } {
  const visitorId = pick(metadata, VISITOR_KEYS)
  const sessionId = pick(metadata, SESSION_KEYS)
  return { ...(visitorId && { visitorId }), ...(sessionId && { sessionId }) }
}

/** Unix seconds or an ISO date to unix ms. */
export function timestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? undefined : parsed
  }
  return undefined
}

/** Drops undefined fields so results compare cleanly and stay JSON-friendly. */
export function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T
}

export function withinTolerance(seconds: number, now: number): boolean {
  return Number.isFinite(seconds) && Math.abs(now / 1000 - seconds) <= TOLERANCE_SECONDS
}
