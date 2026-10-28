import { cleanPath } from '../url'

/** Turns what other tools store into the forms the tracker stores, so imported and tracked rows share breakdown keys. */

const BROWSERS: Record<string, string> = {
  chrome: 'Chrome',
  chromium: 'Chrome',
  crios: 'Chrome',
  'chrome-mobile': 'Chrome',
  'chromium-webview': 'Chrome WebView',
  'chrome-webview': 'Chrome WebView',
  firefox: 'Firefox',
  'firefox-mobile': 'Firefox',
  fxios: 'Firefox',
  safari: 'Safari',
  'mobile-safari': 'Mobile Safari',
  ios: 'Mobile Safari',
  'ios-webview': 'Mobile Safari',
  edge: 'Edge',
  'edge-chromium': 'Edge',
  'edge-ios': 'Edge',
  'microsoft-edge': 'Edge',
  opera: 'Opera',
  'opera-mini': 'Opera',
  samsung: 'Samsung Internet',
  'samsung-browser': 'Samsung Internet',
  'samsung-internet': 'Samsung Internet',
  yandexbrowser: 'Yandex',
  yandex: 'Yandex',
  vivaldi: 'Vivaldi',
  brave: 'Brave',
  duckduckgo: 'DuckDuckGo',
  instagram: 'Instagram',
  facebook: 'Facebook',
  twitter: 'Twitter',
  linkedin: 'LinkedIn',
  tiktok: 'TikTok',
}

const slug = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, '-')

const titleCase = (value: string): string =>
  value.trim().replace(/(^|[\s-])(\p{L})/gu, (_, gap: string, letter: string) => gap + letter.toUpperCase())

export function normalizeBrowser(raw: string | null | undefined): string | null {
  const value = raw?.trim()
  if (!value) return null
  return BROWSERS[slug(value)] ?? titleCase(value).slice(0, 50)
}

export function normalizeOs(raw: string | null | undefined): string | null {
  const value = raw?.trim()
  if (!value) return null
  const lower = value.toLowerCase()
  if (lower.startsWith('windows')) return 'Windows'
  if (lower === 'ios' || lower === 'iphone os') return 'iOS'
  if (lower === 'ipados') return 'iPadOS'
  if (lower.startsWith('android')) return 'Android'
  if (/^(mac ?os|macos|os x)/.test(lower)) return 'Mac OS'
  if (lower === 'chrome os' || lower === 'chromeos' || lower === 'chromium os') return 'Chrome OS'
  if (/^(linux|ubuntu|debian|fedora|arch|gnu\/linux)/.test(lower)) return 'Linux'
  return value.slice(0, 50)
}

export function normalizeDevice(raw: string | null | undefined): 'Desktop' | 'Mobile' | 'Tablet' | null {
  const lower = raw?.trim().toLowerCase()
  if (!lower) return null
  if (lower === 'desktop' || lower === 'laptop' || lower === 'pc') return 'Desktop'
  if (lower === 'mobile' || lower === 'phone' || lower === 'smartphone') return 'Mobile'
  if (lower === 'tablet') return 'Tablet'
  return null
}

let countryByName: Map<string, string> | undefined

/** An ISO 3166 alpha-2 code from a code or an English country name; null when it is neither. */
export function normalizeCountry(raw: string | null | undefined): string | null {
  const value = raw?.trim()
  if (!value) return null
  if (/^[a-z]{2}$/i.test(value)) return value.toUpperCase()
  if (!countryByName) {
    countryByName = new Map()
    const names = new Intl.DisplayNames('en', { type: 'region' })
    for (const a of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      for (const b of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
        const code = a + b
        const name = names.of(code)
        if (name && name !== code) countryByName.set(name.toLowerCase(), code)
      }
    }
  }
  return countryByName.get(value.toLowerCase()) ?? null
}

/**
 * Unix milliseconds from what exports hold: ISO 8601, a Postgres timestamp (`2026-03-16 12:00:00.123+00`, taken as UTC
 * when it has no zone), or epoch seconds or milliseconds. Null when it cannot be read.
 */
export function parseTimestamp(raw: unknown): number | null {
  if (typeof raw === 'number')
    return Number.isFinite(raw) ? (raw < 1e11 ? Math.round(raw * 1000) : Math.round(raw)) : null
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (!text) return null
  if (/^\d+(\.\d+)?$/.test(text)) return parseTimestamp(Number(text))
  let iso = text.replace(' ', 'T')
  iso = iso.replace(/([+-]\d{2})$/, '$1:00').replace(/([+-]\d{2})(\d{2})$/, '$1:$2')
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(iso)) iso += 'Z'
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : ms
}

/** A path or full URL reduced to the path the tracker would store, or null when there is none. */
export function pathOf(raw: string | null | undefined): string | null {
  const value = raw?.trim()
  if (!value) return null
  let path: string
  if (/^https?:\/\//i.test(value)) {
    try {
      path = new URL(value).pathname
    } catch {
      return null
    }
  } else {
    path = value.split(/[?#]/)[0] ?? ''
  }
  if (!path.startsWith('/')) path = `/${path}`
  return cleanPath(path)
}
