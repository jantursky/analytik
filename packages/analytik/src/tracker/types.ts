import type { AttributionIds, PrivacyMode, Props } from '../shared/types'

export interface AnalytikOptions {
  /** Site id. */
  site: string
  /** Base URL of the analytik API, e.g. `https://analytics.example.com/api`. Default `/api`. */
  api?: string
  /** Default `strict`. */
  mode?: PrivacyMode
  /** Track on localhost, `*.local` and `file:` pages. Default false. */
  allowLocalhost?: boolean
  /** Cookie domain in `persistent` mode; links to it and its subdomains are not outbound. */
  domain?: string
  /** Send the first pageview only after the first interaction or 3 s of visibility. Default true. */
  requireInteraction?: boolean
  /** Query parameters kept in page URLs besides campaign keys and payment return ids. */
  keepQuery?: string[]
  /** Log what is sent, and why not, to the console. Default false. */
  debug?: boolean
  /** Track the initial pageview and History API navigation. Default true. */
  autoPageviews?: boolean
  /** Track clicks on links to other sites. Default true. */
  autoOutbound?: boolean
  /** Track clicks on elements with `data-analytik-event`. Default true. */
  autoTrackAttrs?: boolean
}

export interface RevenueOptions {
  /** ISO 4217 code. Defaults to the site currency on the server. */
  currency?: string
  /** De-duplicates the order on the server. */
  orderId?: string
  [prop: string]: string | number | boolean | null | undefined
}

export interface IdentifyInput {
  userId?: string
  email?: string
  name?: string
}

export interface Analytik {
  /** Records a goal (custom event). */
  track: (name: string, props?: Props) => void
  /** Records a client-side order. `amount` is in major units (49.9), as shown to the buyer. */
  revenue: (name: string, amount: number, options?: RevenueOptions) => void
  /** Links the visitor to a user. Ignored without consent unless the mode keeps ids. */
  identify: (user: IdentifyInput) => void
  /** Records a pageview of the current URL unless it was the last one recorded. */
  pageview: () => void
  /** Ids to put in checkout metadata. `null` when opted out or unavailable. */
  attribution: () => Promise<AttributionIds | null>
  consent: () => void
  withdrawConsent: () => void
  /** Stops all tracking in this browser until `optIn()`. */
  optOut: () => void
  optIn: () => void
}

export interface AnalytikClient extends Analytik {
  /** Removes listeners and timers. */
  destroy: () => void
}

export type AnalytikCommand = keyof Analytik

/** `window.analytik`: callable as `analytik('track', 'signup')` and with methods. */
export type AnalytikGlobal = ((command: AnalytikCommand, ...args: unknown[]) => unknown) & Analytik
