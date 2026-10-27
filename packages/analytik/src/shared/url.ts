/** URL handling for collected events: page paths, referrers, campaign tags and domain checks. */

const MAX_PATH = 500

/**
 * Query keys that can carry personal data or credentials. They never reach the database, not even when an
 * integrator lists them in `keepQuery`.
 */
export const PRIVATE_PARAMS: ReadonlySet<string> = new Set(
  [
    'email e-mail mail phone tel name first_name last_name address',
    'password pass pwd secret key api_key apikey',
    'token access_token id_token refresh_token jwt auth code sig signature session sessionid',
  ].flatMap((group) => group.split(' ')),
)

function decodeLeniently(path: string): string {
  try {
    return decodeURI(path)
  } catch {
    return path
  }
}

/** Decoded, with repeated slashes collapsed and no trailing slash (except for the root), at most 500 characters. */
export function normalizePath(pathname: string): string {
  const path = decodeLeniently(pathname || '/').replace(/\/\/+/g, '/')
  const trimmed = path.length > 1 ? path.replace(/\/$/, '') : path
  return trimmed.slice(0, MAX_PATH)
}

/**
 * The page path to store: the normalized pathname plus the `keepQuery` keys that are not private.
 * Campaign tags and fragments are read elsewhere and never stored in the path.
 */
export function pagePath(url: URL, keepQuery: readonly string[] = []): string {
  const kept = [...url.searchParams].filter(([key]) => {
    const lower = key.toLowerCase()
    return keepQuery.includes(lower) && !PRIVATE_PARAMS.has(lower)
  })
  const path = normalizePath(url.pathname)
  return kept.length ? `${path}?${new URLSearchParams(kept).toString()}`.slice(0, MAX_PATH) : path
}

export interface Campaign {
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  utmTerm: string | null
  utmContent: string | null
  ref: string | null
}

export function clip(value: unknown, max = 255): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null
}

export function extractCampaign(url: URL): Campaign {
  const query = url.searchParams
  return {
    utmSource: clip(query.get('utm_source'), 100),
    utmMedium: clip(query.get('utm_medium'), 100),
    utmCampaign: clip(query.get('utm_campaign'), 200),
    utmTerm: clip(query.get('utm_term'), 200),
    utmContent: clip(query.get('utm_content'), 200),
    ref: clip(query.get('ref') ?? query.get('via') ?? query.get('source'), 100),
  }
}

export function stripWww(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '')
}

/** Is `hostname` the domain itself or one of its subdomains? */
export function hostBelongsTo(hostname: string, domain: string): boolean {
  const host = stripWww(hostname)
  const base = stripWww(domain)
  return host === base || host.endsWith(`.${base}`)
}

export function isLocalhost(hostname: string): boolean {
  return /^(localhost|127(\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0)$/.test(hostname) || hostname.endsWith('.localhost')
}

/** `https://www.Example.com/path` → `example.com`. Returns null for anything that is not a plain domain. */
export function cleanDomain(input: string): string | null {
  const domain = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#:].*$/, '')
  return /^([a-z0-9-]+\.)+[a-z]{2,}$/.test(domain) && domain.length <= 253 ? domain : null
}

export interface Referrer {
  referrer: string | null
  referrerDomain: string | null
}

/** Where the visitor came from; navigation inside the site itself is not a referral. */
export function parseReferrer(raw: string | null | undefined, siteDomain: string): Referrer {
  const none = { referrer: null, referrerDomain: null }
  if (!raw) return none
  // Android apps send `android-app://com.google.android.gm/`, which URL parses as an opaque host.
  const app = /^android-app:\/\/([\w.]+)/.exec(raw)
  if (app?.[1]) return { referrer: null, referrerDomain: app[1].slice(0, 255) }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return none
  }
  if (!/^https?:$/.test(url.protocol) || hostBelongsTo(url.hostname, siteDomain)) return none
  return {
    referrer: (stripWww(url.hostname) + normalizePath(url.pathname)).slice(0, MAX_PATH),
    referrerDomain: stripWww(url.hostname),
  }
}
