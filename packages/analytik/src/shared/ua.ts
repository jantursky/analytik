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
