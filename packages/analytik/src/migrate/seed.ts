import { classify } from '../shared/channels'
import { sha256Hex } from '../shared/crypto'
import { DAY, MINUTE, startOfBucket } from '../shared/time'
import type { Statement, Storage } from '../storage/types'

export interface SeedOptions {
  /** Same seed and `now` give the same data. Default 1. */
  seed?: number
  /** Days of history ending today; 0 makes the site without traffic. Default 30. */
  days?: number
  /** Average visitors per day. Default 120. */
  visitorsPerDay?: number
  /** Unix ms the history ends at. Default now. */
  now?: number
  /** Default `demo`. */
  siteId?: string
  /** Default `demo.analytik.dev`. */
  domain?: string
  /** Default `Demo`. */
  name?: string
  /** Default `USD`. */
  currency?: string
  /** Multiplies every price, e.g. 1000 for revenue in the millions. Default 1. */
  priceScale?: number
}

export interface SeedResult {
  siteId: string
  /** API key of the demo site (only meaningful when the site was created by this call). */
  apiKey: string
  counts: { visitors: number; sessions: number; events: number; payments: number; funnels: number }
}

/** mulberry32: tiny, fast, good enough for demo data. */
function prng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

type Weighted<T> = readonly [readonly [T, number], ...(readonly [T, number])[]]

interface Origin {
  referrer?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  ref?: string
}

const ORIGINS: Weighted<Origin> = [
  [{}, 30],
  [{ referrer: 'https://www.google.com/' }, 25],
  [{ referrer: 'https://duckduckgo.com/' }, 4],
  [{ referrer: 'https://t.co/abc' }, 8],
  [{ referrer: 'https://news.ycombinator.com/item' }, 5],
  [{ referrer: 'https://www.reddit.com/r/selfhosted/' }, 6],
  [{ referrer: 'https://chatgpt.com/' }, 5],
  [{ referrer: 'https://github.com/jantursky/analytik' }, 6],
  [{ utmSource: 'newsletter', utmMedium: 'email', utmCampaign: 'october' }, 4],
  [{ utmSource: 'google', utmMedium: 'cpc', utmCampaign: 'brand' }, 4],
  [{ ref: 'producthunt' }, 3],
]

const PLACES: Weighted<{ country: string; region: string; city: string; lat: number; lon: number }> = [
  [{ country: 'US', region: 'CA', city: 'San Francisco', lat: 37.77, lon: -122.42 }, 18],
  [{ country: 'US', region: 'NY', city: 'New York', lat: 40.71, lon: -74.01 }, 14],
  [{ country: 'DE', region: 'BE', city: 'Berlin', lat: 52.52, lon: 13.4 }, 12],
  [{ country: 'GB', region: 'ENG', city: 'London', lat: 51.51, lon: -0.13 }, 10],
  [{ country: 'FR', region: 'IDF', city: 'Paris', lat: 48.86, lon: 2.35 }, 7],
  [{ country: 'SK', region: 'BL', city: 'Bratislava', lat: 48.15, lon: 17.11 }, 4],
  [{ country: 'IN', region: 'KA', city: 'Bengaluru', lat: 12.97, lon: 77.59 }, 8],
  [{ country: 'BR', region: 'SP', city: 'São Paulo', lat: -23.55, lon: -46.63 }, 5],
  [{ country: 'JP', region: '13', city: 'Tokyo', lat: 35.68, lon: 139.69 }, 5],
  [{ country: 'CA', region: 'ON', city: 'Toronto', lat: 43.65, lon: -79.38 }, 6],
]

const CLIENTS: Weighted<{ browser: string; os: string; device: string }> = [
  [{ browser: 'Chrome', os: 'Mac OS', device: 'Desktop' }, 22],
  [{ browser: 'Chrome', os: 'Windows', device: 'Desktop' }, 20],
  [{ browser: 'Safari', os: 'Mac OS', device: 'Desktop' }, 10],
  [{ browser: 'Firefox', os: 'Linux', device: 'Desktop' }, 6],
  [{ browser: 'Edge', os: 'Windows', device: 'Desktop' }, 6],
  [{ browser: 'Mobile Safari', os: 'iOS', device: 'Mobile' }, 20],
  [{ browser: 'Chrome', os: 'Android', device: 'Mobile' }, 12],
  [{ browser: 'Mobile Safari', os: 'iPadOS', device: 'Tablet' }, 4],
]

const LANDING: Weighted<string> = [
  ['/', 45],
  ['/pricing', 12],
  ['/docs', 10],
  ['/blog/privacy-first-analytics', 15],
  ['/blog/cookieless-tracking', 10],
  ['/changelog', 8],
]

const NEXT: Weighted<string> = [
  ['/pricing', 30],
  ['/docs', 20],
  ['/docs/getting-started', 15],
  ['/features', 15],
  ['/signup', 12],
  ['/blog/privacy-first-analytics', 8],
]

const PLANS = [900, 2900, 9900] as const
const BATCH = 500

/**
 * Fills a storage with a believable month of traffic, goals and payments for a demo site.
 * Ids derive from the seed, so running it twice with the same options adds nothing.
 */
export async function seedDemo(storage: Storage, options: SeedOptions = {}): Promise<SeedResult> {
  const random = prng(options.seed ?? 1)
  const now = options.now ?? Date.now()
  const days = options.days ?? 30
  const perDay = options.visitorsPerDay ?? 120
  const siteId = options.siteId ?? 'demo'
  const domain = options.domain ?? 'demo.analytik.dev'
  const currency = options.currency ?? 'USD'
  const priceScale = options.priceScale ?? 1
  const tag = `${options.seed ?? 1}`

  const pick = <T>(items: Weighted<T>): T => {
    const total = items.reduce((sum, [, weight]) => sum + weight, 0)
    let roll = random() * total
    for (const [item, weight] of items) {
      roll -= weight
      if (roll < 0) return item
    }
    return items[0][0]
  }
  const between = (low: number, high: number) => low + Math.floor(random() * (high - low + 1))
  const hex = (length: number) => Array.from({ length }, () => Math.floor(random() * 16).toString(16)).join('')

  await storage.migrate()
  const apiKey = `ak_demo${tag.padStart(4, '0')}${hex(24)}`
  const first = startOfBucket(now - Math.max(days - 1, 0) * DAY, 'day', 'UTC')
  const statements: Statement[] = [
    {
      sql: `INSERT INTO sites (id, name, domain, timezone, currency, privacy_mode, api_key_hash, webhook_secrets,
              retention_days, allow_localhost, ignored_ips, share_token, created_at)
            VALUES (?, ?, ?, 'UTC', ?, 'strict', ?, '{}', NULL, 0, '[]', NULL, ?) ON CONFLICT DO NOTHING`,
      params: [siteId, options.name ?? 'Demo', domain, currency, await sha256Hex(apiKey), first],
    },
  ]
  const counts = { visitors: 0, sessions: 0, events: 0, payments: 0, funnels: 0 }
  // Written in chunks as they are made, so a year of heavy traffic doesn't sit in memory at once.
  const flush = async (all = false): Promise<void> => {
    while (statements.length >= BATCH || (all && statements.length > 0)) {
      await storage.batch(statements.splice(0, BATCH))
    }
  }
  const visitors: string[] = []
  const customers = new Map<string, string>()
  let serial = 0

  for (let day = 0; day < days; day++) {
    const dayStart = first + day * DAY
    const weekday = new Date(dayStart).getUTCDay()
    const volume = Math.round(perDay * (weekday === 0 || weekday === 6 ? 0.6 : 1.1) * (0.75 + random() * 0.5))
    for (let index = 0; index < volume; index++) {
      // Today's last few visits land in the last minutes, so realtime has someone online.
      const recent = day === days - 1 && index < 3
      const start = recent ? now - between(1, 4) * MINUTE : dayStart + Math.floor(random() * DAY)
      if (start >= now) continue
      const returning = visitors.length > 20 && random() < 0.15
      let visitorId = returning ? (visitors[Math.floor(random() * visitors.length)] ?? '') : ''
      if (!visitorId) {
        visitorId = `v${tag}x${(serial++).toString(36).padStart(8, '0')}`
        visitors.push(visitorId)
        counts.visitors++
        statements.push({
          sql: 'INSERT INTO visitors (site_id, id, first_seen) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
          params: [siteId, visitorId, start],
        })
      }
      const sessionId = `s${tag}x${(serial++).toString(36).padStart(10, '0')}`
      const origin = pick(ORIGINS)
      const referrerDomain = origin.referrer ? new URL(origin.referrer).hostname.replace(/^www\./, '') : null
      const { source, channel } = classify({
        referrerDomain,
        utmSource: origin.utmSource,
        utmMedium: origin.utmMedium,
        ref: origin.ref,
      })
      const place = pick(PLACES)
      const client = pick(CLIENTS)
      const pages = [pick(LANDING)]
      const depth = random() < 0.45 ? 1 : between(2, 6)
      while (pages.length < depth) pages.push(pick(NEXT))

      let ts = start
      const events: [string, string | null, string, number][] = []
      for (const path of pages) {
        events.push(['pageview', null, path, ts])
        ts += between(8, 150) * 1000
      }
      let goals = 0
      if (pages.includes('/signup') && random() < 0.5) {
        events.push(['goal', 'signup', '/signup', ts])
        goals++
        ts += 5000
      }
      const checkout = pages.includes('/pricing') && random() < 0.25
      if (checkout) {
        events.push(['goal', 'checkout', '/pricing', ts])
        events.push(['outbound', 'https://checkout.stripe.com/c/pay/cs_demo', '/pricing', ts + 500])
        goals++
        ts += 1000
      } else if (random() < 0.08) {
        events.push(['outbound', 'https://github.com/jantursky/analytik', pages.at(-1) ?? '/', ts])
      }
      const lastSeen = Math.min(ts, now)
      counts.sessions++
      statements.push({
        sql: `INSERT INTO sessions (site_id, id, visitor_id, started_at, last_seen_at, duration, pageviews, goals,
                hostname, entry_page, exit_page, referrer, referrer_domain, source, channel, utm_source, utm_medium,
                utm_campaign, utm_term, utm_content, ref, country, region, city, browser, os, device, lat, lon)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT DO NOTHING`,
        params: [
          siteId,
          sessionId,
          visitorId,
          start,
          lastSeen,
          lastSeen - start,
          pages.length,
          goals,
          domain,
          pages[0],
          pages.at(-1),
          origin.referrer ? `${referrerDomain ?? ''}${new URL(origin.referrer).pathname.replace(/\/$/, '')}` : null,
          referrerDomain,
          source,
          channel,
          origin.utmSource ?? null,
          origin.utmMedium ?? null,
          origin.utmCampaign ?? null,
          origin.ref ?? null,
          place.country,
          place.region,
          place.city,
          client.browser,
          client.os,
          client.device,
          place.lat,
          place.lon,
        ],
      })
      for (const [type, name, path, at] of events) {
        if (at > now) continue
        counts.events++
        statements.push({
          sql: `INSERT INTO events (id, site_id, session_id, visitor_id, ts, type, name, path, props)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
          params: [
            `e${tag}x${(serial++).toString(36).padStart(10, '0')}`,
            siteId,
            sessionId,
            visitorId,
            at,
            type,
            name,
            path,
            null,
          ],
        })
      }

      if (checkout && random() < 0.4 && ts + MINUTE < now) {
        const amount = Math.round((PLANS[Math.floor(random() * PLANS.length)] as number) * priceScale)
        const paymentId = `cs_demo_${hex(16)}`
        const customer = customers.get(visitorId) ?? `cus_demo_${hex(10)}`
        const renewal = customers.has(visitorId)
        customers.set(visitorId, customer)
        const matchedBy = pick<string>([
          ['metadata', 6],
          ['return_page', 2],
          ['email', 1],
          ['timing', 1],
        ])
        const paid = ts + MINUTE
        counts.payments++
        statements.push(
          payment(
            siteId,
            paymentId,
            paid,
            amount,
            'payment',
            currency,
            visitorId,
            sessionId,
            customer,
            renewal,
            matchedBy,
          ),
        )
        if (random() < 0.06 && paid + DAY < now) {
          counts.payments++
          statements.push(
            payment(
              siteId,
              `re_demo_${hex(16)}`,
              paid + DAY,
              -amount,
              'refund',
              currency,
              visitorId,
              sessionId,
              customer,
              false,
              matchedBy,
              paymentId,
            ),
          )
        }
      }
      if (statements.length >= BATCH) await flush()
    }
  }

  const funnels = [
    {
      id: 'demo-signup',
      name: 'Signup',
      steps: [
        { type: 'page', match: '/' },
        { type: 'page', match: '/pricing' },
        { type: 'goal', match: 'signup' },
      ],
    },
    {
      id: 'demo-purchase',
      name: 'Purchase',
      steps: [
        { type: 'page', match: '/pricing' },
        { type: 'goal', match: 'checkout' },
      ],
    },
  ]
  for (const funnel of funnels) {
    counts.funnels++
    statements.push({
      sql: 'INSERT INTO funnels (id, site_id, name, steps, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
      params: [`${funnel.id}-${siteId}`, siteId, funnel.name, JSON.stringify(funnel.steps), first],
    })
  }

  await flush(true)
  return { siteId, apiKey, counts }
}

function payment(
  siteId: string,
  id: string,
  ts: number,
  amount: number,
  kind: 'payment' | 'refund',
  currency: string,
  visitorId: string,
  sessionId: string,
  customerId: string,
  renewal: boolean,
  matchedBy: string,
  orderId: string | null = null,
): Statement {
  return {
    sql: `INSERT INTO payments (id, site_id, provider, ts, amount, kind, currency, visitor_id, session_id, customer_id,
            email, name, renewal, matched_by, subscription_id, order_id)
          VALUES (?, ?, 'stripe', ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL, ?) ON CONFLICT DO NOTHING`,
    params: [id, siteId, ts, amount, kind, currency, visitorId, sessionId, customerId, renewal, matchedBy, orderId],
  }
}
