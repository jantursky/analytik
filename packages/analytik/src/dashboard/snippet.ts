import type { PrivacyMode } from '../shared/types'

export interface SnippetOptions {
  site: string
  /** Absolute API base URL, e.g. `https://analytics.example.com/api`. */
  apiUrl: string
  mode: PrivacyMode
  requireInteraction: boolean
  autoOutbound: boolean
  /** Comma-separated query parameters to keep. */
  keepQuery: string
  /** Seconds between activity updates; 0 only on leaving. Default 240. */
  pingInterval?: number
  debug: boolean
}

const escapeAttr = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The `<script>` tag for a site; attributes that match the defaults are left out. */
export function buildSnippet(options: SnippetOptions): string {
  const api = new URL(options.apiUrl)
  const base = api.href.replace(/\/+$/, '')
  const attrs: [string, string | null][] = [
    ['src', `${api.origin}/analytik.js`],
    ['data-site', options.site],
    ['data-api', base === `${api.origin}/api` ? null : base],
    ['data-mode', options.mode === 'strict' ? null : options.mode],
    ['data-require-interaction', options.requireInteraction ? null : 'false'],
    ['data-auto-outbound', options.autoOutbound ? null : 'false'],
    ['data-keep-query', options.keepQuery.trim() || null],
    [
      'data-ping-interval',
      options.pingInterval === undefined || options.pingInterval === 240 ? null : String(options.pingInterval),
    ],
    ['data-debug', options.debug ? 'true' : null],
  ]
  const rendered = attrs.flatMap(([name, value]) => (value == null ? [] : [`${name}="${escapeAttr(value)}"`]))
  return `<script defer ${rendered.join(' ')}></script>`
}

export interface CampaignParams {
  source: string
  medium?: string
  campaign?: string
  term?: string
  content?: string
}

/** Adds `utm_*` parameters to `base`. `null` when `base` is not an absolute http(s) URL. */
export function buildCampaignUrl(base: string, params: CampaignParams): string | null {
  let url: URL
  try {
    url = new URL(base.trim())
  } catch {
    return null
  }
  if (!/^https?:$/.test(url.protocol)) return null
  for (const [key, value] of Object.entries(params)) {
    const trimmed = (value as string | undefined)?.trim()
    if (trimmed) url.searchParams.set(`utm_${key}`, trimmed)
    else url.searchParams.delete(`utm_${key}`)
  }
  return url.href
}
