/** Reads a user agent string far enough for browser, OS and device reports, and tells bots apart. */

export type Device = 'Desktop' | 'Mobile' | 'Tablet'

export interface ParsedUserAgent {
  browser: string
  os: string
  device: Device
}

/** Lowercase fragments that only non-human clients send. */
const BOT_TOKENS = [
  // crawlers and SEO tools
  'bot',
  'crawl',
  'spider',
  'slurp',
  'ahrefs',
  'semrush',
  'mj12',
  'bytespider',
  'perplexity',
  'chatgpt-user',
  // link previews
  'facebookexternalhit',
  'embedly',
  'quora link preview',
  'whatsapp',
  'telegram',
  'discord',
  'preview',
  // automation, audits and uptime checks
  'headless',
  'phantom',
  'puppeteer',
  'playwright',
  'selenium',
  'lighthouse',
  'pingdom',
  'uptime',
  'monitor',
  'vercel',
  // HTTP libraries
  'curl',
  'wget',
  'python',
  'axios',
  'node-fetch',
  'undici',
  'go-http',
  'java/',
  'okhttp',
  'httpclient',
]

/** True for an empty user agent and for crawlers, link previews, test automation, monitors and HTTP libraries. */
export function isBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true
  const lower = userAgent.toLowerCase()
  return BOT_TOKENS.some((token) => lower.includes(token))
}

type Rule = [name: string, test: RegExp]

/**
 * First match wins. In-app browsers and Chromium-based browsers name themselves next to `Chrome`, and Chrome
 * names `Safari`, so the more specific names come first.
 */
const BROWSER_RULES: Rule[] = [
  ['Instagram', /instagram/i],
  ['Facebook', /FBAN|FBAV|FB_IAB/],
  ['Twitter', /twitter/i],
  ['LinkedIn', /LinkedInApp/],
  ['Threads', /Threads/],
  ['TikTok', /TikTok|musical_ly|Bytedance/],
  ['Edge', /Edg(e|A|iOS)?\//],
  ['Opera', /OPR\/|Opera/],
  ['Samsung Internet', /SamsungBrowser/],
  ['Yandex', /YaBrowser/],
  ['Vivaldi', /Vivaldi/],
  ['Brave', /Brave/],
  ['DuckDuckGo', /DuckDuckGo/],
  ['Arc', /Arc\//],
  ['Firefox', /Firefox|FxiOS/],
  ['Chrome WebView', /; wv\)/],
  ['Chrome', /Chrome|CriOS/],
  ['Mobile Safari', /Mobile\/\w+ Safari|Version\/[\d.]+ Mobile/],
  ['Safari', /Safari/],
  ['WebKit', /AppleWebKit/],
]

/** iPads also claim `Mac OS X`, and Android and Chrome OS claim `Linux`, so they are tested first. */
const OS_RULES: Rule[] = [
  ['iOS', /iPhone|iPod/],
  ['iPadOS', /iPad/],
  ['Android', /Android/],
  ['Windows', /Windows/],
  ['Chrome OS', /CrOS/],
  ['Mac OS', /Macintosh|Mac OS X/],
  ['Linux', /Linux/],
]

const firstMatch = (rules: Rule[], userAgent: string): string =>
  rules.find(([, test]) => test.test(userAgent))?.[0] ?? 'Other'

/** Narrower than this, a screen counts as a phone even when the user agent asks for the desktop site. */
const PHONE_MAX_WIDTH = 600

function deviceOf(userAgent: string, screenWidth: number | undefined): Device {
  const android = userAgent.includes('Android')
  if (/iPad|Tablet/.test(userAgent) || (android && !userAgent.includes('Mobile'))) return 'Tablet'
  if (android || /Mobi|iPhone|iPod/.test(userAgent)) return 'Mobile'
  return screenWidth !== undefined && screenWidth > 0 && screenWidth < PHONE_MAX_WIDTH ? 'Mobile' : 'Desktop'
}

/** `screenWidth` is what the tracker reports; it catches phones in desktop mode. */
export function parseUserAgent(userAgent: string, screenWidth?: number): ParsedUserAgent {
  return {
    browser: firstMatch(BROWSER_RULES, userAgent),
    os: firstMatch(OS_RULES, userAgent),
    device: deviceOf(userAgent, screenWidth),
  }
}

export type BotCategory = 'answers' | 'indexing' | 'training'

export const BOT_CATEGORIES: readonly BotCategory[] = ['answers', 'indexing', 'training']

export interface Crawler {
  name: string
  category: BotCategory
}

/**
 * Known crawlers by a lowercase user agent fragment. First match wins, so a specific agent comes before the
 * family it belongs to (`Applebot-Extended` before `Applebot`).
 * `answers` fetch pages to answer a user's question, `indexing` build a search index, `training` collect
 * content for model training.
 */
const CRAWLERS: [fragment: string, name: string, category: BotCategory][] = [
  ['chatgpt-user', 'ChatGPT-User', 'answers'],
  ['oai-searchbot', 'OAI-SearchBot', 'answers'],
  ['perplexity-user', 'Perplexity-User', 'answers'],
  ['perplexitybot', 'PerplexityBot', 'answers'],
  ['claude-user', 'Claude-User', 'answers'],
  ['claude-searchbot', 'Claude-SearchBot', 'answers'],
  ['duckassistbot', 'DuckAssistBot', 'answers'],
  ['mistralai-user', 'MistralAI-User', 'answers'],
  ['meta-externalfetcher', 'Meta-ExternalFetcher', 'answers'],
  ['gptbot', 'GPTBot', 'training'],
  ['claudebot', 'ClaudeBot', 'training'],
  ['anthropic-ai', 'anthropic-ai', 'training'],
  ['google-extended', 'Google-Extended', 'training'],
  ['applebot-extended', 'Applebot-Extended', 'training'],
  ['meta-externalagent', 'Meta-ExternalAgent', 'training'],
  ['ccbot', 'CCBot', 'training'],
  ['bytespider', 'Bytespider', 'training'],
  ['amazonbot', 'Amazonbot', 'training'],
  ['cohere-ai', 'cohere-ai', 'training'],
  ['diffbot', 'Diffbot', 'training'],
  ['omgili', 'Omgilibot', 'training'],
  ['imagesiftbot', 'ImagesiftBot', 'training'],
  ['googlebot', 'Googlebot', 'indexing'],
  ['google-inspectiontool', 'Google-InspectionTool', 'indexing'],
  ['bingbot', 'Bingbot', 'indexing'],
  ['applebot', 'Applebot', 'indexing'],
  ['duckduckbot', 'DuckDuckBot', 'indexing'],
  ['yandex', 'YandexBot', 'indexing'],
  ['baiduspider', 'Baiduspider', 'indexing'],
  ['slurp', 'Yahoo Slurp', 'indexing'],
  ['ahrefsbot', 'AhrefsBot', 'indexing'],
  ['semrushbot', 'SemrushBot', 'indexing'],
  ['mj12bot', 'MJ12bot', 'indexing'],
]

/**
 * The crawler behind a user agent, or null for a browser. Bots that are not in the list come back as
 * `Other bot` in the indexing category.
 */
export function classifyCrawler(userAgent: string | null | undefined): Crawler | null {
  if (!userAgent || !isBot(userAgent)) return null
  const lower = userAgent.toLowerCase()
  const known = CRAWLERS.find(([fragment]) => lower.includes(fragment))
  return known ? { name: known[1], category: known[2] } : { name: 'Other bot', category: 'indexing' }
}
