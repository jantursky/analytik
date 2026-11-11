import type { Hono } from 'hono'

import type { RandomBytes } from '../shared/ids'
import type { EmailOptions, ScheduledResult } from './email/types'
import type {
  BotFilters,
  BotStats,
  BreakdownRow,
  Dimension,
  EventRow,
  EventType,
  FunnelResult,
  JourneysResult,
  RetentionResult,
  Overview,
  Page,
  Payment,
  Props,
  PaymentInput,
  PaymentKind,
  PrivacyMode,
  Query,
  PropertiesResult,
  Realtime,
  SessionDetail,
  SessionSummary,
  TargetsResult,
  TimeseriesPoint,
  VitalsResult,
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
  /**
   * Events per minute accepted on `/event`, counted in memory by each server instance. `perClient` limits one IP on one
   * site (default 300), `perSite` limits a whole site (default off). `false` turns a limit off. Over the limit the
   * route answers 429 with `Retry-After`. Clients without a known IP are not limited per client.
   */
  rateLimit?: { perClient?: number | false; perSite?: number | false }
  /**
   * Limits for one API key: `perMinute` for all its requests (default 120) and `heavy` for the costly routes (journeys,
   * retention, export, import, searching sessions; default 12). `false` turns a limit off. Over the limit the answer is 429
   * with `Retry-After`. `store` says where requests are counted: `database` (default) is exact across servers, but writes
   * to the database on every call; `memory` writes nothing and counts per server instance, which suits Cloudflare D1 and
   * busy scripts.
   */
  keyRateLimit?: { perMinute?: number | false; heavy?: number | false; store?: 'database' | 'memory' }
  /**
   * Functions of your own that see events and payments. `beforeIngest` runs before an event is stored and may drop or
   * change it; `onEvent` and `onPayment` run after the write. A hook that throws or takes over a second is abandoned
   * and never fails or delays ingest or a payment webhook.
   */
  hooks?: AnalytikHooks
  /** Outbound webhooks: `fetch` replaces the global one, e.g. with one that refuses private addresses after DNS. */
  webhooks?: { fetch?: typeof fetch }
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
  /**
   * Emails the owner about payments, a periodic summary and a silent tracker. Off unless set; what is sent is chosen
   * in the dashboard. Summaries and tracker alerts need `scheduled()` or `POST /api/v1/cron` called every hour.
   */
  email?: EmailOptions
}

export type { EmailMessage, EmailOptions, EmailSend, EmailSettings, ScheduledResult } from './email/types'

/** An event as the hooks see it. Pings and sign-ins are not hooked. */
export interface HookEvent {
  siteId: string
  type: 'pageview' | 'goal' | 'outbound' | 'revenue'
  /** The goal or link target; null for pageviews. */
  name: string | null
  /** The page path, with only the query keys the site keeps. */
  path: string
  props: Props | null
  /** Unix milliseconds. */
  ts: number
}

/** A stored event, for `onEvent`: the event plus the ids it was stored under. */
export interface StoredHookEvent extends HookEvent {
  visitorId: string
  sessionId: string
}

export interface AnalytikHooks {
  /**
   * Before the event is stored. Return `null` to drop it, a changed event to store that instead (only `name`, `path`
   * and `props` can change, and they are cleaned like any client event), or nothing to keep it.
   */
  // `void` lets a hook that returns nothing on some paths type-check.
  /* eslint-disable @typescript-eslint/no-invalid-void-type */
  beforeIngest?: (
    event: HookEvent,
  ) => HookEvent | null | undefined | void | Promise<HookEvent | null | undefined | void>
  /* eslint-enable @typescript-eslint/no-invalid-void-type */
  /** After an event was stored. */
  onEvent?: (event: StoredHookEvent) => void | Promise<void>
  /** After a new payment or refund was recorded; not for a retried webhook. */
  onPayment?: (payment: Payment) => void | Promise<void>
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
  /** The request carries a valid admin session; the site's `ignoreAdmins` switch decides what that means. */
  admin?: boolean
  /**
   * Takes work that may finish after the response (the hourly retention purge), such as `waitUntil` on Workers.
   * Without it, `ingest()` waits for the work.
   */
  defer?: (work: Promise<unknown>) => void
}

export type IngestFiltered = 'bot' | 'ignored-ip' | 'admin' | 'paused' | 'hook'

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
  /**
   * The custom properties of one goal's events: its keys, or with `key` the values of that key (at most 50, the rest
   * as `other`). Goal events only.
   */
  properties(siteId: string, query: Query, options: { name: string; key?: string }): Promise<PropertiesResult>
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
  /** Progress of the site's goal targets in their own periods, whatever range the dashboard shows. */
  targets(siteId: string): Promise<TargetsResult>
  /** The 75th percentile of Core Web Vitals over the range, for the site and its pages with the most reports. */
  vitals(siteId: string, query: Query): Promise<VitalsResult>
  /** How sessions move between pages: the first four pages of the newest sessions, at most the last 30 days. */
  journeys(siteId: string, query: Query): Promise<JourneysResult>
  retention(siteId: string, query: Query): Promise<RetentionResult>
  /** Crawler traffic reported with `POST /v1/bots`, kept apart from visitors and revenue. */
  bots(siteId: string, query: Query, filters?: BotFilters): Promise<BotStats>
}

export interface Analytik {
  /** Fetch handler for Workers, Bun, Node (`@hono/node-server`) and Vercel. */
  app: Hono
  storage: Storage
  ingest(input: IngestInput): Promise<IngestResult>
  recordPayment(input: RecordPaymentInput): Promise<RecordPaymentResult>
  stats: StatsApi
  /**
   * Sends the summary if it is due and the tracker-down alerts. Safe to call every hour, or more often: each email
   * goes out once. Call it from a Worker's `scheduled` handler.
   */
  scheduled(options?: { url?: string }): Promise<ScheduledResult>
}
