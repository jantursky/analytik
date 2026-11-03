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
  // In-app browsers.
  ['Instagram', /instagram/i],
  ['Facebook', /FBAN|FBAV|FB_IAB/],
  ['Twitter', /twitter/i],
  ['LinkedIn', /LinkedInApp/],
  ['Threads', /Threads/],
  ['TikTok', /TikTok|musical_ly|Bytedance/],
  ['Pinterest', /Pinterest/i],
  ['Snapchat', /Snapchat/i],
  ['Line', /\bLine\/\d/],
  ['Reddit', /Reddit/],
  ['WeChat', /MicroMessenger/],
  ['Weibo', /Weibo/i],
  ['Alipay', /AlipayClient/],
  ['DingTalk', /DingTalk/],
  ['KakaoTalk', /KAKAOTALK/i],
  ['Google App', /\bGSA\//],
  // Chromium-based browsers and apps, which also name `Chrome` and `Safari`.
  ['Edge', /Edg(e|A|iOS)?\//],
  ['Internet Explorer', /MSIE |Trident\//],
  ['Opera Mini', /Opera Mini/],
  ['Opera', /OPR\/|Opera/],
  ['Samsung Internet', /SamsungBrowser/],
  ['Yandex', /YaBrowser/],
  ['UC Browser', /UCBrowser|UCWEB/],
  ['Quark', /Quark\//],
  ['QQ Browser', /MQQBrowser|QQBrowser/],
  ['360 Browser', /360SE|360EE|QihooBrowser/],
  ['Sogou', /SogouMobileBrowser|MetaSr/],
  ['Baidu', /baidubrowser|baiduboxapp|BIDUBrowser/i],
  ['Huawei Browser', /HuaweiBrowser/],
  ['Mi Browser', /MiuiBrowser/],
  ['Vivo Browser', /VivoBrowser/],
  ['HeyTap Browser', /HeyTapBrowser|OppoBrowser/],
  ['Whale', /Whale\//],
  ['Coc Coc', /coc_coc_browser/],
  ['Avast Secure', /Avast(SecureBrowser)?\//],
  ['AVG Secure', /AVG(SecureBrowser)?\//],
  ['Comodo Dragon', /Comodo_Dragon|Chromodo/],
  ['Epic', /Epic\//],
  ['Sleipnir', /Sleipnir/],
  ['Maxthon', /Maxthon|MXBrowser/],
  ['Silk', /Silk\//],
  ['Puffin', /Puffin/],
  ['Ecosia', /Ecosia/],
  ['Electron', /Electron\//],
  ['Vivaldi', /Vivaldi/],
  ['Brave', /Brave/],
  ['DuckDuckGo', /DuckDuckGo/],
  ['Arc', /Arc\//],
  ['Chromium', /Chromium\//],
  // Gecko-based browsers, which also name `Firefox`.
  ['Waterfox', /Waterfox/],
  ['LibreWolf', /LibreWolf/],
  ['Pale Moon', /PaleMoon/],
  ['SeaMonkey', /SeaMonkey/],
  ['Floorp', /Floorp/],
  ['IceCat', /IceCat/],
  ['K-Meleon', /K-Meleon/],
  ['Firefox Focus', /Focus\//],
  ['Firefox', /Firefox|FxiOS/],
  // Browsers on their own engines or on WebKit without the Chrome name.
  ['Falkon', /Falkon/],
  ['Konqueror', /Konqueror/],
  ['Epiphany', /Epiphany/],
  ['Midori', /Midori/],
  ['Otter', /OtterBrowser/],
  ['NetSurf', /NetSurf/],
  ['Lynx', /^Lynx/],
  ['Chrome WebView', /; wv\)/],
  ['Chrome', /Chrome|CriOS/],
  ['Android Browser', /Android.*Version\/[\d.]+/],
  ['Mobile Safari', /Mobile\/\w+ Safari|Version\/[\d.]+ Mobile/],
  ['Safari', /Safari/],
  ['WebKit', /AppleWebKit/],
]

/**
 * iPads also claim `Mac OS X`, and Android, Chrome OS, Tizen and the Linux distributions claim `Linux` (and many TVs
 * and phones `Android`), so the specific systems are tested first.
 */
const OS_RULES: Rule[] = [
  ['iOS', /iPhone|iPod/],
  ['iPadOS', /iPad/],
  ['Windows Phone', /Windows Phone/],
  ['HarmonyOS', /HarmonyOS|OpenHarmony/],
  ['KaiOS', /KAIOS/i],
  ['Fire OS', /Kindle Fire|\bKF[A-Z]{2,}\b|\bAFT[A-Z]+\b/],
  ['Android TV', /Android[^)]*(\bTV\b|BRAVIA)/],
  ['Android', /Android/],
  ['Xbox', /Xbox/],
  ['Windows', /Windows/],
  ['Chrome OS', /CrOS/],
  ['Mac OS', /Macintosh|Mac OS X/],
  ['PlayStation', /PlayStation/],
  ['Nintendo', /Nintendo/],
  ['Roku', /Roku/],
  ['Tizen', /Tizen/],
  ['webOS', /Web0S|webOS|hpwOS/i],
  ['BlackBerry', /BlackBerry|BB10|RIM Tablet/],
  ['Symbian', /Symbian|Series60/],
  ['Sailfish OS', /Sailfish/],
  ['Ubuntu', /Ubuntu/],
  ['Debian', /Debian/],
  ['Fedora', /Fedora/],
  ['Linux Mint', /Linux Mint/],
  ['openSUSE', /SUSE/i],
  ['Red Hat', /Red ?Hat/],
  ['CentOS', /CentOS/],
  ['Gentoo', /Gentoo/],
  ['Arch Linux', /Arch ?Linux/],
  ['Manjaro', /Manjaro/],
  ['Raspberry Pi OS', /Raspbian/],
  ['Deepin', /Deepin/],
  ['FreeBSD', /FreeBSD/],
  ['OpenBSD', /OpenBSD/],
  ['NetBSD', /NetBSD/],
  ['Solaris', /SunOS|Solaris/],
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
