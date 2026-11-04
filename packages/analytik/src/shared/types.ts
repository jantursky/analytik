/** Shared contract between the server, tracker, client and dashboard. */
import type { BotCategory } from './ua'

export type { BotCategory }

export type PrivacyMode = 'strict' | 'enriched' | 'persistent'
export type Interval = 'hour' | 'day' | 'week' | 'month'
export type EventType = 'pageview' | 'goal' | 'outbound' | 'ping' | 'identify' | 'revenue'
export type PaymentKind = 'payment' | 'refund'
export type PaymentMatch = 'metadata' | 'return_page' | 'customer' | 'email' | 'timing'
export type PaymentProvider = 'stripe' | 'dodo' | 'lemonsqueezy' | 'paddle' | 'polar' | 'razorpay' | 'creem' | 'gumroad'

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

/** How long a goal target runs; each period starts in the site's time zone (weeks on Monday). */
export type TargetPeriod = 'week' | 'month' | 'quarter'

/** "1,000 `signup` goals a month": the number a goal should reach within one period. */
export interface GoalTarget {
  goal: string
  target: number
  period: TargetPeriod
}

/** One target with the count so far in its current period. */
export interface TargetProgress extends GoalTarget {
  /** Goals recorded since the period began. */
  count: number
  /** Unix ms, `[start, end)` of the current period in the site's time zone. */
  start: number
  end: number
  /** Where the period would end at the current pace; null until a tenth of the period has passed. */
  projection: number | null
}

export interface TargetsResult {
  /** Unix ms the counts were taken. */
  now: number
  targets: TargetProgress[]
}

export interface Site {
  id: string
  name: string
  domain: string
  timezone: string
  currency: string
  privacyMode: PrivacyMode
  retentionDays: number | null
  allowLocalhost: boolean
  /** Tracking is paused: tracker events and server goals are dropped, payments are still recorded. */
  paused: boolean
  /** Addresses and CIDR ranges whose events are dropped. */
  ignoredIps: string[]
  /** Events from browsers with an admin session are dropped (same-origin setups only). */
  ignoreAdmins: boolean
  /** Targets for goals, at most 20. */
  targets: GoalTarget[]
  /** Share of page views, in percent, that measure Core Web Vitals; 0 turns it off. */
  vitalsSample: number
  createdAt: number
  /** Which payment providers have a webhook secret configured. Secrets themselves are never returned. */
  webhooks?: Record<PaymentProvider, boolean>
  /** Token for the public read-only dashboard link, or null when sharing is off. */
  shareToken?: string | null
}

/** The groups of site settings that can be set once for every site. */
export const DEFAULT_GROUPS = {
  basics: ['timezone', 'currency', 'allowLocalhost'],
  privacy: ['privacyMode', 'retentionDays', 'ignoredIps', 'ignoreAdmins'],
  tracking: ['vitalsSample', 'targets'],
} as const

export type DefaultsGroup = keyof typeof DEFAULT_GROUPS

/** What a new site starts with, and what "apply to all sites" copies onto the existing ones. */
export type SiteDefaults = Pick<Site, (typeof DEFAULT_GROUPS)[DefaultsGroup][number]>

/** Core Web Vitals of one page load: Largest Contentful Paint and Interaction to Next Paint in ms, Cumulative Layout Shift as a score. */
export interface Vitals {
  l?: number
  i?: number
  c?: number
}

export type VitalMetric = 'lcp' | 'inp' | 'cls'

/** The 75th percentile of each metric over some reports; null when none of them measured it. */
export interface VitalValues {
  /** Reports that carry any metric. */
  samples: number
  lcp: number | null
  inp: number | null
  cls: number | null
}

/** Core Web Vitals of a range: the whole site and its pages with the most reports. */
export interface VitalsResult {
  /** Whether the site measures them at all. */
  enabled: boolean
  total: VitalValues
  pages: (VitalValues & { path: string })[]
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
  /** Core Web Vitals, sent once with the update on leaving a page when the site measures them. */
  v?: Vitals
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
  /**
   * The site the checkout came from, from `analytik_site_id` in the checkout metadata. A webhook for another site
   * ignores the payment, so one provider account can feed several sites.
   */
  siteId?: string
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
  /** Also return the same numbers for the period just before (`previous`) or a year earlier (`year`). */
  compare?: Comparison
}

export type Comparison = 'previous' | 'year'

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

/** A site's headline numbers on the sites overview, from `GET /summary`. */
export interface SiteSummary {
  siteId: string
  visitors: number
  /** Revenue in the site's currency, minor units. */
  revenue: number
  orders: number
  currency: string
  online: number
  /** Visitors per bucket from the start of the range; only when a series was asked for. */
  traffic?: number[]
  /** Revenue per bucket (minor units), same buckets as `traffic`. */
  sales?: number[]
  /** The window before, of equal length; only when a comparison was asked for. */
  previous?: { visitors: number; revenue: number; orders: number }
}

export interface TimeseriesPoint {
  /** Bucket start, unix milliseconds. */
  ts: number
  visitors: number
  sessions: number
  pageviews: number
  revenue: number
  orders: number
  /** Share of the bucket's sessions with one pageview and no goal, 0 to 1. */
  bounceRate: number
  avgDurationMs: number
  /** Paying customers (first payments) over visitors, 0 to 1. */
  conversionRate: number
  revenuePerVisitor: number
  /** The bucket at the same position in the comparison period, when `compare` was asked for. */
  previous?: Omit<TimeseriesPoint, 'previous' | 'notes'>
  /** Notes dated inside this bucket; left out when there are none. */
  notes?: Annotation[]
}

/** A dated note on a site's charts, such as "launched on Product Hunt". */
export interface Annotation {
  id: string
  /** The day or moment the note is about, unix milliseconds. */
  ts: number
  /** Plain text, at most 200 characters. */
  text: string
  createdAt: number
}

export interface BreakdownRow {
  key: string
  visitors: number
  sessions: number
  pageviews: number
  revenue: number
  orders: number
  conversionRate: number
  /** The row's numbers in the comparison period (all 0 when it had none), when `compare` was asked for. */
  previous?: Omit<BreakdownRow, 'key' | 'previous'>
}

export interface Realtime {
  online: number
  recent: { ts: number; type: EventType; name: string | null; path: string | null; country: string | null }[]
  /** Visits seen in the last five minutes that have coordinates, newest first. */
  locations: RealtimeVisit[]
}

export interface RealtimeVisit {
  lat: number
  lon: number
  country: string | null
  city: string | null
  sessionId: string
  visitorId: string
  /** The page the visitor is on now (the visit's last page). */
  page: string | null
  source: string
  browser: string | null
  device: string | null
  startedAt: number
  lastSeen: number
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
  /** For the next page in the default order; null on the last page, and whenever `sort` or `offset` is used. */
  nextCursor: string | null
  /** Rows matching the query across all pages. */
  total: number
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
  analytik_site_id: string
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

/** What `POST /debug/generate` writes. Every field is optional. */
export interface TestDataInput {
  /** Write into this site instead of making new test sites. */
  siteId?: string
  /** New test sites to make, 1 to 20. Default 1. */
  sites?: number
  /** Days of history ending now, 0 to 730; 0 makes empty sites. Default 30. */
  days?: number
  /** Average visits per day and site, 0 to 100,000; 0 makes empty sites. Default 500. */
  visitorsPerDay?: number
  /** Multiplies every price (900, 2,900 and 9,900 minor units), e.g. 1000 for revenue in the millions. Default 1. */
  priceScale?: number
  /** Currency of new test sites. Default `USD`. */
  currency?: string
  /**
   * Make the new sites differ like real ones: an empty site, a quiet blog, a busy shop, a paused one and more, in
   * turn. `visitorsPerDay` and `priceScale` then don't apply.
   */
  mix?: boolean
}

export interface TestDataResult {
  sites: { id: string; name: string }[]
  counts: { visitors: number; sessions: number; events: number; payments: number }
  /** How long writing took, in ms. */
  durationMs: number
}

/** The running version, and the newest release on npm when it could be looked up. */
export interface VersionInfo {
  current: string
  latest: string | null
}

/** Crawler traffic reported by a site's backend; see `bot_requests`. */
export interface BotRequest {
  ts: number
  crawler: string
  category: BotCategory
  path: string
}

export interface BotStats {
  /** Requests in the range that match the filters. */
  total: number
  /** Requests per bucket, every bucket of the range present. */
  series: { ts: number; requests: number }[]
  categories: { key: BotCategory; requests: number }[]
  crawlers: { key: string; category: BotCategory; requests: number }[]
  pages: { key: string; requests: number }[]
  /** Newest first. */
  recent: BotRequest[]
  /** Whether the site has ever had a bot request, so the dashboard can show setup help instead of empty charts. */
  hasData: boolean
}

/** Filters of a bot query. Several values for one field match any of them; a page ending in `*` is a prefix. */
export interface BotFilters {
  crawler?: string[]
  category?: BotCategory[]
  page?: string[]
}

export type SummaryFrequency = 'off' | 'daily' | 'weekly'

/** What the owner chose in Settings → Email. */
export interface EmailSettings {
  /** Recipient; empty uses the server's `email.to`. */
  to: string
  /** Email after each new payment. */
  payments: boolean
  summary: SummaryFrequency
  /** Hour of the day (0-23) in `timezone` after which the summary is sent. */
  hour: number
  /** Email when a site that had traffic goes 24 hours without events. */
  down: boolean
  /** IANA time zone the summary hour and period are read in. */
  timezone: string
}

/** `GET /email`: the saved settings and whether the server has a sender to use them. */
export interface EmailState {
  configured: boolean
  /** The server's default recipient, used while `settings.to` is empty. */
  to: string | null
  settings: EmailSettings
}

/** The dashboard views a share link can be limited to. An empty list means every shareable view. */
export const SHARE_VIEWS = [
  'overview',
  'sources',
  'pages',
  'events',
  'sessions',
  'bots',
  'funnels',
  'realtime',
] as const
export type ShareView = (typeof SHARE_VIEWS)[number]

/** A read-only link to one site's dashboard. The token itself is shown once, when the link is created. */
export interface ShareLink {
  id: string
  siteId: string
  label: string
  views: ShareView[]
  createdAt: number
  /** Unix ms after which the link stops working; null for no expiry. */
  expiresAt: number | null
  revokedAt: number | null
}
