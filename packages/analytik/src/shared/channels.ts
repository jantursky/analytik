/** Where a visit came from: a source name and the marketing channel it belongs to. */

export type Channel = 'Direct' | 'Organic Search' | 'Organic Social' | 'AI' | 'Referral' | 'Email' | 'Paid'

export const CHANNELS: readonly Channel[] = [
  'Direct',
  'Organic Search',
  'Organic Social',
  'AI',
  'Referral',
  'Email',
  'Paid',
]

export interface SourceEntry {
  name: string
  channel: Channel
  /**
   * Hostnames that belong to the source; subdomains match too. A trailing `.*` stands for any public suffix
   * (`google.*` matches `google.de` and `google.co.uk`).
   */
  hosts: readonly string[]
  /** Lowercase `utm_source` / `ref` values that name the source besides its hosts. */
  tags: readonly string[]
}

export const DIRECT_SOURCE = 'Direct/None'

type Entry = [name: string, hosts: string[], tags?: string[]]

const CATALOG: [Channel, Entry[]][] = [
  [
    'Organic Search',
    [
      ['Google', ['google.*'], ['google']],
      ['Bing', ['bing.com'], ['bing']],
      ['DuckDuckGo', ['duckduckgo.com'], ['duckduckgo', 'ddg']],
      ['Yahoo', ['yahoo.*'], ['yahoo']],
      ['Yandex', ['yandex.*'], ['yandex']],
      ['Baidu', ['baidu.com'], ['baidu']],
      ['Ecosia', ['ecosia.org'], ['ecosia']],
      ['Brave Search', ['search.brave.com']],
    ],
  ],
  [
    'AI',
    [
      ['ChatGPT', ['chatgpt.com', 'openai.com'], ['chatgpt', 'openai']],
      ['Claude', ['claude.ai'], ['claude']],
      ['Perplexity', ['perplexity.ai'], ['perplexity']],
      ['Gemini', ['gemini.google.com', 'bard.google.com'], ['gemini']],
      ['Copilot', ['copilot.microsoft.com'], ['copilot']],
      ['DeepSeek', ['deepseek.com'], ['deepseek']],
      ['Grok', ['grok.com'], ['grok']],
    ],
  ],
  [
    'Organic Social',
    [
      ['X', ['x.com', 'twitter.com', 't.co'], ['x', 'twitter', 'tw']],
      ['YouTube', ['youtube.com', 'youtu.be'], ['youtube', 'yt']],
      ['LinkedIn', ['linkedin.com', 'lnkd.in'], ['linkedin']],
      ['Reddit', ['reddit.com'], ['reddit']],
      ['Facebook', ['facebook.com', 'fb.com', 'fb.me'], ['facebook', 'fb']],
      ['Instagram', ['instagram.com'], ['instagram', 'ig']],
      ['Threads', ['threads.net', 'threads.com'], ['threads']],
      ['TikTok', ['tiktok.com'], ['tiktok']],
      ['Pinterest', ['pinterest.*'], ['pinterest']],
      ['Bluesky', ['bsky.app'], ['bluesky', 'bsky']],
      ['Mastodon', ['mastodon.social', 'mastodon.online', 'mastodon.*'], ['mastodon']],
      ['Hacker News', ['news.ycombinator.com'], ['hackernews', 'hn']],
    ],
  ],
  [
    'Referral',
    [
      ['Product Hunt', ['producthunt.com'], ['producthunt', 'ph']],
      ['Medium', ['medium.com'], ['medium']],
      ['Substack', ['substack.com'], ['substack']],
      ['Dev.to', ['dev.to'], ['devto']],
      ['Indie Hackers', ['indiehackers.com'], ['indiehackers']],
      ['GitHub', ['github.com'], ['github']],
    ],
  ],
  [
    'Email',
    [
      ['Gmail', ['mail.google.com', 'com.google.android.gm'], ['gmail']],
      ['Outlook', ['outlook.com', 'outlook.live.com', 'outlook.office.com']],
      ['Newsletter', [], ['newsletter', 'email', 'mail']],
    ],
  ],
]

export const SOURCE_CATALOG: readonly SourceEntry[] = CATALOG.flatMap(([channel, entries]) =>
  entries.map(([name, hosts, tags = []]) => ({ name, channel, hosts, tags })),
)

/** Matched against `utm_medium`; these decide the channel even for a known source. */
const MEDIUM_CHANNELS: [RegExp, Channel][] = [
  [/^(cpc|ppc|cpm|paid|paid[_-]?social|paidsearch|ads?|display|retargeting|sponsored)$/, 'Paid'],
  [/^(e-?mail|newsletter)$/, 'Email'],
]
/** Matched against `utm_medium` only when the source is unknown. */
const SOCIAL_MEDIUM = /^(social|social[_-]?media|sm)$/

/** How many labels of `host` a pattern covers, or 0 when it doesn't match. */
function hostScore(host: string, pattern: string): number {
  const labels = host.split('.')
  if (!pattern.endsWith('.*')) {
    return host === pattern || host.endsWith('.' + pattern) ? pattern.split('.').length : 0
  }
  const base = pattern.slice(0, -2)
  const at = labels.lastIndexOf(base.split('.').at(-1) ?? '')
  const suffix = labels.slice(at + 1)
  // A public suffix here is one or two short labels: `de`, `com`, `co.uk`, `com.br`.
  const isSuffix = suffix.length >= 1 && suffix.length <= 2 && suffix.every((label) => /^[a-z]{2,3}$/.test(label))
  const head = labels.slice(0, at + 1).join('.')
  return at >= 0 && isSuffix && (head === base || head.endsWith('.' + base)) ? base.split('.').length : 0
}

/**
 * The known source named by a tag (`twitter`) or hostname (`m.youtube.com`). The most specific host wins,
 * so `mail.google.com` is Gmail rather than Google.
 */
export function matchSource(key: string | null | undefined): SourceEntry | undefined {
  const value = key
    ?.trim()
    .toLowerCase()
    .replace(/^www\./, '')
  if (!value) return undefined
  const tagged = SOURCE_CATALOG.find((source) => source.tags.includes(value))
  if (tagged) return tagged
  let best: SourceEntry | undefined
  let bestScore = 0
  for (const source of SOURCE_CATALOG) {
    for (const pattern of source.hosts) {
      const score = hostScore(value, pattern)
      if (score > bestScore) [best, bestScore] = [source, score]
    }
  }
  return best
}

/** The domain to show a favicon for, when the source is a known one with a website. */
export function sourceDomain(name: string): string | undefined {
  const host = SOURCE_CATALOG.find((source) => source.name === name)?.hosts[0]
  return host?.replace(/\.\*$/, '.com')
}

export interface ClassifyInput {
  referrerDomain: string | null
  utmSource?: string | null
  utmMedium?: string | null
  ref?: string | null
}

export interface SourceAndChannel {
  source: string
  channel: Channel
}

/**
 * Decides where a visit came from. A `utm_source` or `ref` tag wins over the referrer, since tags name the exact
 * post or campaign (`?ref=launch-post`). A paid or email `utm_medium` sets the channel whatever the source is.
 */
export function classify({ referrerDomain, utmSource, utmMedium, ref }: ClassifyInput): SourceAndChannel {
  // Empty tags count as missing.
  const tag = [utmSource, ref].find((value) => !!value) ?? null
  const known = matchSource(tag) ?? matchSource(referrerDomain)
  const source = known?.name ?? tag ?? referrerDomain ?? DIRECT_SOURCE
  const medium = utmMedium?.trim().toLowerCase() ?? ''
  const byMedium = MEDIUM_CHANNELS.find(([pattern]) => pattern.test(medium))?.[1]
  const channel: Channel =
    byMedium ??
    known?.channel ??
    (SOCIAL_MEDIUM.test(medium) ? 'Organic Social' : tag || referrerDomain ? 'Referral' : 'Direct')
  return { source, channel }
}
