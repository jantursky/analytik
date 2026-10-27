import type { Analytik, Geo } from 'analytik/server'

// Synthetic visitors for the public demo, so the Realtime view moves. Everything goes through the real `ingest()`,
// the same path a tracker request takes, and the simulator's own rows are pruned so memory stays flat.

const TICK_MS = 4000
/** Stop when nobody has asked for anything for this long; the next request starts it again. */
const IDLE_MS = 10 * 60 * 1000
const MAX_ACTIVE = 12
/** Simulated sessions kept in the database; older ones are deleted with their events and payments. */
const MAX_SESSIONS = 400
const PRUNE_BATCH = 50

type Weighted<T> = readonly [readonly [T, number], ...(readonly [T, number])[]]

const pick = <T>(random: () => number, items: Weighted<T>): T => {
  const total = items.reduce((sum, [, weight]) => sum + weight, 0)
  let roll = random() * total
  let chosen = items[0][0]
  for (const [item, weight] of items) {
    chosen = item
    roll -= weight
    if (roll < 0) break
  }
  return chosen
}

const PLACES: Weighted<Geo> = [
  [{ country: 'US', region: 'CA', city: 'San Francisco', lat: 37.77, lon: -122.42 }, 10],
  [{ country: 'US', region: 'NY', city: 'New York', lat: 40.71, lon: -74.01 }, 9],
  [{ country: 'US', region: 'TX', city: 'Austin', lat: 30.27, lon: -97.74 }, 4],
  [{ country: 'CA', region: 'ON', city: 'Toronto', lat: 43.65, lon: -79.38 }, 4],
  [{ country: 'BR', region: 'SP', city: 'São Paulo', lat: -23.55, lon: -46.63 }, 4],
  [{ country: 'GB', region: 'ENG', city: 'London', lat: 51.51, lon: -0.13 }, 8],
  [{ country: 'DE', region: 'BE', city: 'Berlin', lat: 52.52, lon: 13.4 }, 8],
  [{ country: 'FR', region: 'IDF', city: 'Paris', lat: 48.86, lon: 2.35 }, 5],
  [{ country: 'NL', region: 'NH', city: 'Amsterdam', lat: 52.37, lon: 4.9 }, 4],
  [{ country: 'SK', region: 'BL', city: 'Bratislava', lat: 48.15, lon: 17.11 }, 3],
  [{ country: 'PL', region: '14', city: 'Warsaw', lat: 52.23, lon: 21.01 }, 3],
  [{ country: 'IN', region: 'KA', city: 'Bengaluru', lat: 12.97, lon: 77.59 }, 6],
  [{ country: 'JP', region: '13', city: 'Tokyo', lat: 35.68, lon: 139.69 }, 4],
  [{ country: 'AU', region: 'NSW', city: 'Sydney', lat: -33.87, lon: 151.21 }, 3],
  [{ country: 'ZA', region: 'WC', city: 'Cape Town', lat: -33.92, lon: 18.42 }, 2],
]

const AGENTS: Weighted<{ ua: string; sw: number }> = [
  [
    {
      ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      sw: 1512,
    },
    6,
  ],
  [
    {
      ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      sw: 1920,
    },
    6,
  ],
  [
    {
      ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
      sw: 1440,
    },
    3,
  ],
  [{ ua: 'Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0', sw: 1920 }, 2],
  [
    {
      ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
      sw: 393,
    },
    6,
  ],
  [
    {
      ua: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
      sw: 412,
    },
    3,
  ],
]

/** Referrer or campaign query of the first pageview. */
const SOURCES: Weighted<{ referrer?: string; query?: string }> = [
  [{}, 8],
  [{ referrer: 'https://www.google.com/' }, 8],
  [{ referrer: 'https://duckduckgo.com/' }, 2],
  [{ referrer: 'https://news.ycombinator.com/' }, 3],
  [{ referrer: 'https://www.reddit.com/r/selfhosted/' }, 2],
  [{ referrer: 'https://chatgpt.com/' }, 2],
  [{ referrer: 'https://github.com/jantursky/analytik' }, 2],
  [{ query: '?utm_source=newsletter&utm_medium=email&utm_campaign=october' }, 2],
  [{ query: '?ref=producthunt' }, 1],
]

const LANDING: Weighted<string> = [
  ['/', 10],
  ['/pricing', 3],
  ['/blog/privacy-first-analytics', 3],
  ['/docs', 2],
]

const NEXT: Weighted<string> = [
  ['/pricing', 5],
  ['/features', 2],
  ['/docs', 2],
  ['/checkout', 1],
]

const PLANS = [
  { id: 'solo', amount: 29 },
  { id: 'studio', amount: 79 },
] as const

interface Visitor {
  ip: string
  ua: string
  sw: number
  geo: Geo
  path: string
  steps: number
}

export interface SimulatorOptions {
  analytik: Pick<Analytik, 'ingest' | 'storage'>
  siteId: string
  /** Origin of the simulated pages; it must be the site's domain. */
  origin: string
  random?: () => number
  now?: () => number
}

export interface Simulator {
  /** One round: a few new visitors arrive, some active ones move on or leave. */
  tick(): Promise<void>
  /** Call on every request: starts the timer if it is not running and keeps it alive. */
  touch(): void
  stop(): void
}

export function createSimulator({
  analytik,
  siteId,
  origin,
  random = Math.random,
  now = Date.now,
}: SimulatorOptions): Simulator {
  let active: Visitor[] = []
  const sessions: { session: string; visitor: string }[] = []
  const known = new Set<string>()
  let timer: ReturnType<typeof setInterval> | undefined
  let lastTouch = 0
  let running = false

  const send = async (visitor: Visitor, payload: Record<string, unknown>) => {
    const result = await analytik.ingest({
      payload: { w: siteId, u: origin + visitor.path, sw: visitor.sw, ...payload },
      ip: visitor.ip,
      userAgent: visitor.ua,
      geo: visitor.geo,
    })
    if (result.status === 202 && result.sessionId && result.visitorId && !known.has(result.sessionId)) {
      known.add(result.sessionId)
      sessions.push({ session: result.sessionId, visitor: result.visitorId })
    }
  }

  const arrive = async () => {
    const agent = pick(random, AGENTS)
    const source = pick(random, SOURCES)
    const block = pick(random, [
      ['192.0.2', 1],
      ['198.51.100', 1],
      ['203.0.113', 1],
    ])
    const visitor: Visitor = {
      ip: `${block}.${1 + Math.floor(random() * 254)}`,
      ua: agent.ua,
      sw: agent.sw,
      geo: pick(random, PLACES),
      path: pick(random, LANDING) + (source.query ?? ''),
      steps: 1 + Math.floor(random() * 4),
    }
    active.push(visitor)
    await send(visitor, { t: 'pageview', r: source.referrer })
  }

  const advance = async (visitor: Visitor) => {
    await send(visitor, { t: 'ping', d: 5000 + Math.floor(random() * 40000) })
    visitor.steps--
    const path = visitor.path.split('?')[0]
    if (path === '/' && random() < 0.25) {
      await send(visitor, { t: 'goal', n: 'trial_click', p: { location: 'hero' } })
      return
    }
    if (path === '/pricing' && random() < 0.4) {
      const plan = PLANS[random() < 0.6 ? 0 : 1]
      await send(visitor, { t: 'goal', n: 'plan_select', p: { plan: plan.id, price: plan.amount } })
      visitor.path = '/checkout'
      await send(visitor, { t: 'pageview' })
      return
    }
    if (path === '/checkout') {
      if (random() < 0.15) {
        const plan = PLANS[random() < 0.6 ? 0 : 1]
        visitor.path = '/thank-you'
        await send(visitor, { t: 'pageview' })
        await send(visitor, {
          t: 'revenue',
          n: 'purchase',
          a: plan.amount,
          c: 'USD',
          o: `sim_${now().toString(36)}_${Math.floor(random() * 1e6).toString(36)}`,
          p: { plan: plan.id },
        })
      }
      visitor.steps = 0
      return
    }
    visitor.path = pick(random, NEXT)
    await send(visitor, { t: 'pageview' })
  }

  /** Deletes the oldest simulated sessions, their events and payments, once there are more than the cap. */
  const prune = async () => {
    if (sessions.length <= MAX_SESSIONS) return
    const old = sessions.splice(0, PRUNE_BATCH)
    for (const { session } of old) known.delete(session)
    const marks = old.map(() => '?').join(', ')
    const ids = old.map(({ session }) => session)
    await analytik.storage.batch([
      { sql: `DELETE FROM events WHERE site_id = ? AND session_id IN (${marks})`, params: [siteId, ...ids] },
      { sql: `DELETE FROM payments WHERE site_id = ? AND session_id IN (${marks})`, params: [siteId, ...ids] },
      { sql: `DELETE FROM sessions WHERE site_id = ? AND id IN (${marks})`, params: [siteId, ...ids] },
      {
        sql: `DELETE FROM visitors WHERE site_id = ? AND id IN (${marks})
                AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.site_id = visitors.site_id AND s.visitor_id = visitors.id)`,
        params: [siteId, ...old.map(({ visitor }) => visitor)],
      },
    ])
  }

  const tick = async () => {
    const arrivals = Math.floor(random() * 2.5)
    for (let i = 0; i < arrivals && active.length < MAX_ACTIVE; i++) await arrive()
    const movers = active.filter(() => random() < 0.5).slice(0, 3)
    for (const visitor of movers) await advance(visitor)
    active = active.filter((visitor) => visitor.steps > 0)
    await prune()
  }

  const stop = () => {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
  }

  const loop = () => {
    if (now() - lastTouch > IDLE_MS) {
      stop()
      return
    }
    // Skip a round rather than overlap when the previous one is still writing.
    if (running) return
    running = true
    tick()
      .catch((error: unknown) => {
        console.error('demo simulator:', error)
      })
      .finally(() => {
        running = false
      })
  }

  return {
    tick,
    stop,
    touch() {
      lastTouch = now()
      if (timer !== undefined) return
      timer = setInterval(loop, TICK_MS)
      loop()
      // A Node timer would otherwise keep the dev server process alive on shutdown.
      if (typeof timer === 'object' && 'unref' in timer) timer.unref()
    },
  }
}
