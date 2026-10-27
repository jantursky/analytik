import type { Hono } from 'hono'

import type { RandomBytes } from '../shared/ids'
import type {
  BreakdownRow,
  Dimension,
  EventRow,
  EventType,
  FunnelResult,
  Overview,
  Page,
  Payment,
  PaymentInput,
  PaymentKind,
  PrivacyMode,
  Query,
  Realtime,
  SessionDetail,
  SessionSummary,
  TimeseriesPoint,
} from '../shared/types'
import type { Storage } from '../storage/types'

/** Password login with an HMAC-signed session cookie. `secret` signs the cookie; use 32+ random characters. */
export interface AdminPasswordAuth {
  password: string
  secret: string
}

/** Bring your own auth (Cloudflare Access, your app's session): return true for admins. */
export interface AdminCustomAuth {
  verify(request: Request): boolean | Promise<boolean>
}

export type AdminAuth = AdminPasswordAuth | AdminCustomAuth

export interface PrivacyOptions {
  /** Mode for new sites; each site can override it. Default `strict`. */
  mode?: PrivacyMode
  /** Extra query keys kept in stored page paths. Private keys (`email`, `token`, ...) are always dropped. */
  keepQuery?: string[]
  /** Downgrade `enriched` and `persistent` to `strict` for Do Not Track and Global Privacy Control. Default true. */
  respectDoNotTrack?: boolean
}

/**
 * Which pages may send events. `site-domains` (default): the site's domain and its subdomains.
 * A list adds hostnames (and their subdomains) on top of that. `any` turns the check off.
 */
export type AllowedOrigins = 'site-domains' | 'any' | string[]

/**
 * Which proxy headers carry the client IP. `auto` (default): `cf-connecting-ip` when the request has
 * Cloudflare's `request.cf`, Vercel's `x-vercel-forwarded-for` when `x-vercel-id` is present, and no IP
 * otherwise, so a client can't pick its own by sending forwarding headers. `forwarded` reads the rightmost
 * public address in `x-forwarded-for`; use it only behind a proxy that sets or appends that header.
 * `false` ignores every header.
 */
export type TrustProxy = 'auto' | 'cloudflare' | 'vercel' | 'forwarded' | false

export interface Geo {
  country: string | null
  region: string | null
  city: string | null
  lat: number | null
  lon: number | null
}

export interface CreateAnalytikOptions {
  storage: Storage
  /** Without it, the admin routes answer 401. */
  admin?: AdminAuth
  privacy?: PrivacyOptions
  allowedOrigins?: AllowedOrigins
  /** Default `/api`. */
  basePath?: string
  /** Apply pending migrations before the first request. Default true. */
  autoMigrate?: boolean
  /** Clock override for tests. */
  now?: () => number
  /** Random source override for tests. */
  random?: RandomBytes
  /** Location for a request. Default: Vercel `x-vercel-ip-*` headers, then Cloudflare `request.cf`. */
  geo?: (request: Request) => Geo | null | Promise<Geo | null>
  /**
   * Where the client IP comes from (rate limits, ignored IPs, the strict-mode hash). Default `auto`.
   * Without an IP, strict-mode visitors are told apart by user agent only and rate limits are shared.
   */
  trustProxy?: TrustProxy
  /** Your own client IP lookup; overrides `trustProxy`. Return null when unknown. */
  clientIp?: (request: Request) => string | null
  /**
   * Turns on the admin routes under `/debug` that fill the database with generated test data, and the dashboard's
   * Debug settings that use them. For local testing: leave it off where the data is real. Default false.
   */
  debug?: boolean
  /**
   * Lets the dashboard offer an update: `GET /version` asks the npm registry for the newest release, from this
   * server, at most every six hours. Default true; `false` makes no request. The dashboard sends nothing to npm.
   */
  updateCheck?: boolean
}

export interface IngestInput {
  /** Untrusted tracker payload; validated like an HTTP request body. */
  payload: unknown
  /** Used for the strict-mode hash and the ignored-IP list, never stored. */
  ip?: string | null
  userAgent?: string | null
  /** `Origin` header of the request, checked against the allowed origins when present. */
  origin?: string | null
  geo?: Geo | null
  /** Do Not Track or Global Privacy Control was sent. */
  doNotTrack?: boolean
}

export type IngestFiltered = 'bot' | 'ignored-ip' | 'paused'

export type IngestResult =
  | { status: 202; visitorId: string | null; sessionId: string | null; filtered?: IngestFiltered }
  | { status: 400 | 403 | 404; error: string }

export interface RecordPaymentInput extends PaymentInput {
  siteId: string
  /** `stripe`, `dodo`, `lemonsqueezy`, `client` (tracker revenue events) or `api`. Default `api`. */
  provider?: string
}

export interface RecordPaymentResult {
  payment: Payment
  /** True when a payment with this id was already recorded; nothing changed. */
  duplicate: boolean
}

export interface PageOptions {
  /** Keyset cursor from the previous page; only in the default order (newest first) and without `offset`. */
  cursor?: string | null
  /** Default 50, at most 500. */
  limit?: number
  /** Rows to skip, for numbered pages. */
  offset?: number
  /** A column of the list (see each list's sort keys); default the time, newest first. */
  sort?: string
  /** Default `desc`. */
  order?: 'asc' | 'desc'
  /** Case-insensitive text matched anywhere in the list's text columns. */
  search?: string
  /** Only rows of this visitor id. */
  visitor?: string
}

export interface EventsOptions extends PageOptions {
  name?: string
  type?: EventType
}

export interface PaymentsOptions extends PageOptions {
  kind?: PaymentKind
  provider?: string
  /** `true` for payments matched to a visit, `false` for unattributed ones. */
  attributed?: boolean
}

export type ExportFormat = 'json' | 'csv'
export type ExportTable = 'visitors' | 'sessions' | 'events' | 'payments'

export interface PurgeResult {
  events: number
  sessions: number
  visitors: number
}

export interface RematchResult {
  checked: number
  matched: number
}

/** Read access to the numbers, for server code (SSR, reports). Throws `AnalytikError` (404) for unknown sites. */
export interface StatsApi {
  overview(siteId: string, query: Query): Promise<Overview>
  timeseries(siteId: string, query: Query): Promise<TimeseriesPoint[]>
  breakdown(siteId: string, dimension: Dimension, query: Query, options?: { limit?: number }): Promise<BreakdownRow[]>
  realtime(siteId: string): Promise<Realtime>
  sessions(siteId: string, query: Query, options?: PageOptions): Promise<Page<SessionSummary>>
  session(siteId: string, sessionId: string): Promise<SessionDetail | null>
  events(siteId: string, query: Query, options?: EventsOptions): Promise<Page<EventRow>>
  funnel(siteId: string, funnelId: string, query: Query): Promise<FunnelResult | null>
  payments(siteId: string, query: Query, options?: PaymentsOptions): Promise<Page<Payment>>
  /** JSON: everything for the site. CSV: one table (default `events`). */
  export(siteId: string, format: ExportFormat, table?: ExportTable): Promise<string>
  /**
   * Deletes events, sessions and orphaned visitors before `before` (unix ms). Payments are kept for the
   * revenue numbers, with their email, name, customer, visitor and session cleared.
   */
  purge(siteId: string, before: number): Promise<PurgeResult>
}

export interface Analytik {
  /** Fetch handler for Workers, Bun, Node (`@hono/node-server`) and Vercel. */
  app: Hono
  storage: Storage
  ingest(input: IngestInput): Promise<IngestResult>
  recordPayment(input: RecordPaymentInput): Promise<RecordPaymentResult>
  stats: StatsApi
}
