/** Shared contract between the server, tracker, client and dashboard. */

export type PrivacyMode = 'strict' | 'enriched' | 'persistent'
export type Interval = 'hour' | 'day' | 'week' | 'month'
export type EventType = 'pageview' | 'goal' | 'outbound' | 'ping' | 'identify' | 'revenue'
export type PaymentKind = 'payment' | 'refund'
export type PaymentMatch = 'metadata' | 'return_page' | 'customer' | 'email' | 'timing'
export type PaymentProvider = 'stripe' | 'dodo' | 'lemonsqueezy'

export type Dimension =
  | 'channel'
  | 'source'
  | 'referrer'
  | 'campaign'
  | 'medium'
  | 'term'
  | 'content'
  | 'ref'
  | 'page'
  | 'entry'
  | 'exit'
  | 'country'
  | 'region'
  | 'city'
  | 'browser'
  | 'os'
  | 'device'
  | 'event'
  | 'outbound'
  | 'goal'

export type Props = Record<string, string | number | boolean | null>

export interface Site {
  id: string
  name: string
  domain: string
  timezone: string
  currency: string
  privacyMode: PrivacyMode
  retentionDays: number | null
  allowLocalhost: boolean
  ignoredIps: string[]
  createdAt: number
  /** Which payment providers have a webhook secret configured. Secrets themselves are never returned. */
  webhooks?: Record<PaymentProvider, boolean>
  /** Token for the public read-only dashboard link, or null when sharing is off. */
  shareToken?: string | null
}

/** What the tracker posts to `POST {basePath}/event`. Without `m` the server treats the event as `strict`. */
export interface TrackerPayload {
  w: string
  t: EventType
  u: string
  r?: string
  vid?: string
  sid?: string
  sw?: number
  n?: string
  p?: Props
  d?: number
  a?: number
  c?: string
  o?: string
  m?: PrivacyMode
}

export interface PaymentInput {
  id: string
  /** Minor units (cents). */
  amount: number
  currency: string
  kind?: PaymentKind
  email?: string
  name?: string
  customerId?: string
  subscriptionId?: string
  orderId?: string
  visitorId?: string
  sessionId?: string
  renewal?: boolean
  /** Unix milliseconds. Defaults to now. */
  ts?: number
  /**
   * Refunds without their own id: the total refunded for the order so far. Only the part not recorded yet is
   * stored, so a second partial refund adds the difference and a retried webhook adds nothing.
   */
  refundedTotal?: number
}

export interface Payment extends Required<Pick<PaymentInput, 'id' | 'amount' | 'currency'>> {
  siteId: string
  provider: string
  kind: PaymentKind
  ts: number
  visitorId: string | null
  sessionId: string | null
  customerId: string | null
  email: string | null
  name: string | null
  renewal: boolean
  matchedBy: PaymentMatch | null
  subscriptionId: string | null
  orderId: string | null
}

// eslint-disable-next-line @typescript-eslint/consistent-indexed-object-style -- an interface, so integrators can extend it
export interface Filters {
  [dimension: string]: string | undefined
}

export interface Query {
  /** Unix milliseconds, inclusive. */
  from: number
  /** Unix milliseconds, exclusive. */
  to: number
  interval?: Interval
  tz?: string
  filters?: Filters
}

export interface Delta {
  value: number
  previous: number
  /** Relative change, `null` when `previous` is 0. */
  change: number | null
}

export interface Overview {
  visitors: Delta
  sessions: Delta
  pageviews: Delta
  bounceRate: Delta
  avgDurationMs: Delta
  revenue: Delta
  orders: Delta
  conversionRate: Delta
  revenuePerVisitor: Delta
  currency: string
  online: number
  /** Payments in other currencies than the site's, left out of the revenue numbers above. */
  otherCurrencies: { currency: string; amount: number; orders: number }[]
}

export interface TimeseriesPoint {
  /** Bucket start, unix milliseconds. */
  ts: number
  visitors: number
  sessions: number
  pageviews: number
  revenue: number
}

export interface BreakdownRow {
  key: string
  visitors: number
  sessions: number
  pageviews: number
  revenue: number
  orders: number
  conversionRate: number
}

export interface Realtime {
  online: number
  recent: { ts: number; type: EventType; name: string | null; path: string | null; country: string | null }[]
  locations: { lat: number; lon: number; country: string | null; city: string | null }[]
}

export interface SessionSummary {
  id: string
  visitorId: string
  startedAt: number
  durationMs: number
  pageviews: number
  goals: number
  entryPage: string | null
  exitPage: string | null
  source: string
  channel: string
  country: string | null
  city: string | null
  browser: string | null
  os: string | null
  device: string | null
  revenue: number
}

export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

export interface Funnel {
  id: string
  name: string
  steps: FunnelStep[]
}

export interface FunnelStep {
  type: 'page' | 'goal'
  /** Page path (supports a trailing `*`) or goal name. */
  match: string
}

export interface FunnelResult {
  funnel: Funnel
  steps: { match: string; visitors: number; dropOff: number | null }[]
}

export interface AttributionIds {
  analytik_visitor_id: string
  analytik_session_id: string
}

export interface EventRow {
  id: string
  ts: number
  type: EventType
  name: string | null
  path: string | null
  props: Props | null
  sessionId: string
  visitorId: string
}

export interface VisitorProfile {
  id: string
  firstSeen: number
  userId: string | null
  name: string | null
  email: string | null
  sessions: number
}

export interface SessionDetail {
  session: SessionSummary
  visitor: VisitorProfile | null
  events: EventRow[]
  payments: Payment[]
}
