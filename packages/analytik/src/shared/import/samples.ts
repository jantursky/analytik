import { DAY } from '../time'
import type { ImportSource } from './types'

/** One file of a sample export. */
export interface SampleFile {
  name: string
  content: string
}

export interface SampleOptions {
  /** How many visits to make. */
  visits: number
  /** Visits start somewhere in the last this many days, up to `now`. */
  days: number
  now: number
}

interface Profile {
  browser: string
  os: string
  device: 'desktop' | 'mobile' | 'tablet'
  screen: [number, number]
  lang: [string, string]
  country: string
  region: string
  city: string
  agent: string
}

const PROFILES: Profile[] = [
  {
    browser: 'Chrome',
    os: 'Windows',
    device: 'desktop',
    screen: [1920, 1080],
    lang: ['en', 'US'],
    country: 'US',
    region: 'US-CA',
    city: 'San Francisco',
    agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0 Safari/537.36',
  },
  {
    browser: 'Safari',
    os: 'iOS',
    device: 'mobile',
    screen: [390, 844],
    lang: ['de', 'DE'],
    country: 'DE',
    region: 'DE-BE',
    city: 'Berlin',
    agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile Safari/604.1',
  },
  {
    browser: 'Firefox',
    os: 'Linux',
    device: 'desktop',
    screen: [1440, 900],
    lang: ['en', 'GB'],
    country: 'GB',
    region: 'GB-ENG',
    city: 'London',
    agent: 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
  },
  {
    browser: 'Chrome',
    os: 'Android',
    device: 'mobile',
    screen: [412, 915],
    lang: ['sk', 'SK'],
    country: 'SK',
    region: 'SK-BL',
    city: 'Bratislava',
    agent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/141.0 Mobile Safari/537.36',
  },
  {
    browser: 'Safari',
    os: 'macOS',
    device: 'desktop',
    screen: [1728, 1117],
    lang: ['fr', 'FR'],
    country: 'FR',
    region: 'FR-IDF',
    city: 'Paris',
    agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.0 Safari/605.1.15',
  },
  {
    browser: 'Edge',
    os: 'Windows',
    device: 'tablet',
    screen: [1280, 800],
    lang: ['pl', 'PL'],
    country: 'PL',
    region: 'PL-MZ',
    city: 'Warsaw',
    agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edge/141.0 Safari/537.36',
  },
]

const PAGES = ['/', '/pricing', '/blog', '/blog/hello-world', '/docs', '/docs/getting-started', '/about', '/contact']
const REFERRERS: { domain: string; path: string; query: string }[] = [
  { domain: 'www.google.com', path: '/', query: '' },
  { domain: 'news.ycombinator.com', path: '/item', query: 'id=42' },
  { domain: 'twitter.com', path: '/', query: '' },
]
const CAMPAIGNS = [{ source: 'newsletter', medium: 'email', campaign: 'launch' }]
const GOALS = ['signup', 'download']

interface Hit {
  ts: number
  path: string
  goal: string | null
}

interface SampleVisit {
  id: number
  profile: Profile
  referrer: (typeof REFERRERS)[number] | null
  campaign: (typeof CAMPAIGNS)[number] | null
  hits: Hit[]
}

/** A small deterministic random source, so the same options always make the same files. */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeVisits({ visits, days, now }: SampleOptions): SampleVisit[] {
  const next = random(visits * 31 + days)
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)] as T
  const span = Math.max(1, days) * DAY
  return Array.from({ length: visits }, (_, id) => {
    const start = now - Math.floor(next() * span) - 60_000
    const length = 1 + Math.floor(next() * 4)
    const hits: Hit[] = []
    let ts = start
    for (let i = 0; i < length; i++) {
      hits.push({ ts, path: i === 0 ? pick(PAGES) : pick(PAGES.slice(1)), goal: null })
      ts += 5_000 + Math.floor(next() * 90_000)
    }
    const last = hits.at(-1)
    if (last && next() < 0.2) hits.push({ ts: last.ts + 2_000, path: last.path, goal: pick(GOALS) })
    const roll = next()
    return {
      id,
      profile: pick(PROFILES),
      referrer: roll < 0.5 ? pick(REFERRERS) : null,
      campaign: roll >= 0.5 && roll < 0.6 ? pick(CAMPAIGNS) : null,
      hits,
    }
  }).sort((a, b) => (a.hits[0]?.ts ?? 0) - (b.hits[0]?.ts ?? 0))
}

const cell = (value: string | number | boolean | null): string => {
  const text = value === null ? '' : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}
const csv = (header: string[], rows: (string | number | boolean | null)[][]): string =>
  `${[header, ...rows].map((row) => row.map(cell).join(',')).join('\n')}\n`

/** Umami writes timestamps the way Postgres prints them. */
const umamiTime = (ts: number): string => `${new Date(ts).toISOString().slice(0, 23).replace('T', ' ')}+00`

const UMAMI_OS: Record<string, string> = {
  Windows: 'Windows 10',
  iOS: 'iOS',
  Linux: 'Linux',
  Android: 'Android OS',
  macOS: 'Mac OS',
}
const UMAMI_BROWSER: Record<string, string> = {
  Chrome: 'chrome',
  Safari: 'safari',
  Firefox: 'firefox',
  Edge: 'edge-chromium',
}

function umami(visits: SampleVisit[]): SampleFile[] {
  const events: (string | number | null)[][] = []
  const sessions: (string | number | null)[][] = []
  const data: (string | number | null)[][] = []
  for (const visit of visits) {
    const { profile, referrer, campaign } = visit
    const session = `s${visit.id}`
    const first = visit.hits[0]?.ts ?? 0
    sessions.push([
      session,
      'w1',
      UMAMI_BROWSER[profile.browser] ?? profile.browser.toLowerCase(),
      UMAMI_OS[profile.os] ?? profile.os,
      profile.device === 'tablet' ? 'tablet' : profile.device === 'mobile' ? 'mobile' : 'desktop',
      `${profile.screen[0]}x${profile.screen[1]}`,
      profile.lang.join('-'),
      profile.country,
      profile.region,
      profile.city,
      null,
      umamiTime(first),
    ])
    visit.hits.forEach((hit, index) => {
      const id = `e${visit.id}-${index}`
      events.push([
        id,
        'w1',
        session,
        `v${visit.id}`,
        umamiTime(hit.ts),
        hit.path,
        null,
        index === 0 ? (campaign?.source ?? null) : null,
        index === 0 ? (campaign?.medium ?? null) : null,
        index === 0 ? (campaign?.campaign ?? null) : null,
        index === 0 ? (referrer?.domain ?? null) : null,
        index === 0 ? (referrer?.path ?? null) : null,
        index === 0 ? (referrer?.query ? `?${referrer.query}` : null) : null,
        hit.path,
        hit.goal ? 2 : 1,
        hit.goal,
        'www.example.com',
      ])
      if (hit.goal) {
        data.push([`d${id}`, 'w1', id, 'plan', 'pro', null, null, 1, umamiTime(hit.ts)])
      }
    })
  }
  return [
    {
      name: 'umami-website_event.csv',
      content: csv(
        [
          'event_id',
          'website_id',
          'session_id',
          'visit_id',
          'created_at',
          'url_path',
          'url_query',
          'utm_source',
          'utm_medium',
          'utm_campaign',
          'referrer_domain',
          'referrer_path',
          'referrer_query',
          'page_title',
          'event_type',
          'event_name',
          'hostname',
        ],
        events,
      ),
    },
    {
      name: 'umami-session.csv',
      content: csv(
        [
          'session_id',
          'website_id',
          'browser',
          'os',
          'device',
          'screen',
          'language',
          'country',
          'region',
          'city',
          'distinct_id',
          'created_at',
        ],
        sessions,
      ),
    },
    {
      name: 'umami-event_data.csv',
      content: csv(
        [
          'event_data_id',
          'website_id',
          'website_event_id',
          'data_key',
          'string_value',
          'number_value',
          'date_value',
          'data_type',
          'created_at',
        ],
        data,
      ),
    },
  ]
}

function simpleAnalytics(visits: SampleVisit[]): SampleFile[] {
  const rows: (string | number | boolean | null)[][] = []
  for (const visit of visits) {
    const { profile, referrer, campaign } = visit
    visit.hits.forEach((hit, index) => {
      const entry = index === 0
      rows.push([
        new Date(hit.ts).toISOString(),
        'example.com',
        hit.path,
        hit.goal ?? 'pageview',
        false,
        entry,
        entry && referrer ? `https://${referrer.domain}${referrer.path}` : null,
        entry ? (referrer?.domain ?? null) : null,
        entry ? (referrer?.path ?? null) : null,
        entry ? (campaign?.source ?? null) : null,
        entry ? (campaign?.medium ?? null) : null,
        entry ? (campaign?.campaign ?? null) : null,
        null,
        profile.agent,
        profile.device,
        profile.country,
        profile.browser,
        '141',
        profile.os === 'macOS' ? 'Mac OS X' : profile.os,
        '',
        profile.screen[0],
        profile.screen[1],
        profile.lang[0],
        profile.lang[1],
        `u${visit.id}-${index}`,
        // Simple Analytics numbers each page load, not each visit.
        `p${visit.id}-${index}`,
      ])
    })
  }
  return [
    {
      name: 'simple-analytics-export.csv',
      content: csv(
        [
          'added_iso',
          'hostname',
          'path',
          'datapoint',
          'is_robot',
          'is_unique',
          'document_referrer',
          'referrer_hostname',
          'referrer_path',
          'utm_source',
          'utm_medium',
          'utm_campaign',
          'duration_seconds',
          'user_agent',
          'device_type',
          'country_code',
          'browser_name',
          'browser_version',
          'os_name',
          'os_version',
          'screen_width',
          'screen_height',
          'lang_language',
          'lang_region',
          'uuid',
          'session_id',
        ],
        rows,
      ),
    },
  ]
}

/** Made-up export files in the format a platform writes, to try the importer without a real export. */
export function sampleExport(source: ImportSource, options: SampleOptions): SampleFile[] {
  const visits = makeVisits(options)
  return source === 'umami' ? umami(visits) : simpleAnalytics(visits)
}
