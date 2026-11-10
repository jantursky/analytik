import { fromBase64, toBase64, toHex } from '../shared/crypto'
import { isTestDomain } from '../shared/test-sites'
import { DAY, HOUR } from '../shared/time'
import type { SyncChange, SyncField, SyncPreview, TrackerStatus } from '../shared/types'
import { AnalytikError, type Context } from './context'
import { publicHost } from './public-host'
import { type SiteRecord, requireSite } from './sites'

/** Icons are small; anything bigger is not one. */
const MAX_ICON = 100_000
const MAX_HTML = 200_000
const MAX_MANIFEST = 50_000
const TIMEOUT_MS = 4000
const MAX_HOPS = 3
/** A stored icon older than this is fetched again the next time it is asked for. */
const ICON_MAX_AGE = 30 * DAY
/** After a site could not be read, the server waits this long before it tries again on its own. */
const RETRY_AFTER = HOUR

export const SYNC_FIELDS: readonly SyncField[] = ['name', 'color', 'icon']

export interface FoundIcon {
  type: string
  bytes: Uint8Array
  hash: string
}

export interface SiteReading {
  /** The home page was read. */
  reachable: boolean
  name: string | null
  color: string | null
  icon: FoundIcon | null
  tracker: TrackerStatus
}

interface Fetched {
  response: Response
  /** The address the answer came from, after redirects. */
  url: string
}

/**
 * A GET that only goes to https and public host names, and checks every redirect hop the same way. Null when the
 * address is refused, the answer is not a success, or the request fails or takes too long.
 */
async function fetchPublic(url: string, accept: string): Promise<Fetched | null> {
  let current = url
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    let target: URL
    try {
      target = new URL(current)
    } catch {
      return null
    }
    if (target.protocol !== 'https:' || !publicHost(target.hostname)) return null
    let response: Response
    try {
      response = await fetch(target.href, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept },
      })
    } catch {
      return null
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) return null
      current = new URL(location, target).href
      continue
    }
    return response.ok ? { response, url: target.href } : null
  }
  return null
}

/** The body up to `max` bytes. `truncated` says the rest was left unread. */
async function readUpTo(response: Response, max: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    return { bytes: bytes.slice(0, max), truncated: bytes.length > max }
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let truncated = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.length
    if (total > max) {
      truncated = true
      await reader.cancel().catch(() => undefined)
      break
    }
  }
  const bytes = new Uint8Array(Math.min(total, max))
  let offset = 0
  for (const chunk of chunks) {
    const part = chunk.subarray(0, Math.max(0, Math.min(chunk.length, max - offset)))
    bytes.set(part, offset)
    offset += part.length
  }
  return { bytes, truncated }
}

const decoder = new TextDecoder()

/** The value of an attribute in one tag, quoted either way or bare. */
function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(tag)
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code.startsWith('#')) {
      const point = code[1]?.toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1))
      return Number.isInteger(point) && point > 0 && point < 0x110000 ? String.fromCodePoint(point) : whole
    }
    return ENTITIES[code.toLowerCase()] ?? whole
  })
}

const clean = (text: string): string => decodeEntities(text).replace(/\s+/g, ' ').trim().slice(0, 100)

/** `og:site_name`, else the page title. */
function pageName(html: string): string | null {
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = (attribute(tag, 'property') ?? attribute(tag, 'name'))?.toLowerCase()
    const content = attribute(tag, 'content')
    if (key === 'og:site_name' && content && clean(content)) return clean(content)
  }
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]
  return title && clean(title) ? clean(title) : null
}

/** The first `theme-color` that is a plain hex colour, as `#rrggbb`. */
function pageColor(html: string): string | null {
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (attribute(tag, 'name')?.toLowerCase() !== 'theme-color') continue
    const value = attribute(tag, 'content')?.trim().toLowerCase()
    if (value && /^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(value)) {
      return value.length === 4 ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}` : value
    }
  }
  return null
}

/** The `href` of each icon link (`icon`, `shortcut icon`, `apple-touch-icon`) in a page; plain icons come before touch icons. */
function iconLinks(html: string): string[] {
  const links: { href: string; rank: number }[] = []
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = attribute(tag, 'rel')?.toLowerCase() ?? ''
    const href = attribute(tag, 'href')
    if (!href || !/\bicon\b/.test(rel.replace('apple-touch-icon', 'touch icon'))) continue
    // A plain icon is the right size for a tile; the big touch icons come last.
    links.push({ href: decodeEntities(href), rank: rel.includes('apple') ? 1 : 0 })
  }
  return links.sort((a, b) => a.rank - b.rank).map((link) => link.href)
}

function manifestLink(html: string): string | undefined {
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    if (attribute(tag, 'rel')?.toLowerCase().split(/\s+/).includes('manifest')) {
      const href = attribute(tag, 'href')
      if (href) return decodeEntities(href)
    }
  }
  return undefined
}

/** Whether a script of the page is this server's tracker: from its host, or carrying the site's id. */
function loadsTracker(html: string, base: string, host: string | null, siteId: string): boolean {
  for (const [tag] of html.matchAll(/<script\b[^>]*>/gi)) {
    const src = attribute(tag, 'src')
    if (!src) continue
    let url: URL
    try {
      url = new URL(decodeEntities(src), base)
    } catch {
      continue
    }
    if (!url.pathname.endsWith('/analytik.js')) continue
    if ((host !== null && url.host === host) || attribute(tag, 'data-site') === siteId) return true
  }
  return false
}

const resolveAgainst = (href: string, base: string): string[] => {
  try {
    return [new URL(href, base).href]
  } catch {
    return []
  }
}

async function iconAt(url: string): Promise<FoundIcon | null> {
  const fetched = await fetchPublic(url, 'image/*')
  if (!fetched) return null
  const type = fetched.response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
  const isIco = type === 'application/octet-stream' && new URL(fetched.url).pathname.endsWith('.ico')
  if (!type.startsWith('image/') && !isIco) return null
  const { bytes, truncated } = await readUpTo(fetched.response, MAX_ICON)
  if (bytes.length === 0 || truncated) return null
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>))
  return { type: isIco ? 'image/x-icon' : type, bytes, hash: toHex(digest).slice(0, 16) }
}

/** Icon addresses a web app manifest names, those nearest 64 px first. */
async function manifestIcons(href: string, base: string): Promise<string[]> {
  const url = resolveAgainst(href, base)[0]
  const fetched = url ? await fetchPublic(url, 'application/manifest+json,application/json') : null
  if (!fetched) return []
  try {
    const { bytes, truncated } = await readUpTo(fetched.response, MAX_MANIFEST)
    if (truncated) return []
    const manifest = JSON.parse(decoder.decode(bytes)) as { icons?: { src?: unknown; sizes?: unknown }[] }
    const size = (sizes: unknown): number => Number.parseInt(typeof sizes === 'string' ? sizes : '', 10) || 1000
    return (manifest.icons ?? [])
      .filter((icon): icon is { src: string; sizes?: unknown } => typeof icon.src === 'string')
      .sort((a, b) => Math.abs(size(a.sizes) - 64) - Math.abs(size(b.sizes) - 64))
      .slice(0, 3)
      .flatMap((icon) => resolveAgainst(icon.src, fetched.url))
  } catch {
    return []
  }
}

/** The first icon found among the page's links, then its manifest's, then `/favicon.ico`. */
async function findIcon(html: string, page: string): Promise<FoundIcon | null> {
  const tried = new Set<string>()
  const attempt = async (urls: string[]): Promise<FoundIcon | null> => {
    for (const url of urls) {
      if (tried.has(url)) continue
      tried.add(url)
      const icon = await iconAt(url)
      if (icon) return icon
    }
    return null
  }
  const linked = await attempt(iconLinks(html).flatMap((href) => resolveAgainst(href, page)))
  if (linked) return linked
  const manifest = manifestLink(html)
  const fromManifest = manifest ? await attempt(await manifestIcons(manifest, page)) : null
  return fromManifest ?? (await attempt([new URL('/favicon.ico', page).href]))
}

/**
 * Reads a tracked site's home page for its name, theme colour and icon, and whether it loads this server's tracker.
 * The server does the asking, so the browser never contacts the site just because someone opened the dashboard. Only
 * public host names are asked, over https.
 */
export async function readSite(domain: string, tracker: { host: string | null; siteId: string }): Promise<SiteReading> {
  const empty: SiteReading = { reachable: false, name: null, color: null, icon: null, tracker: 'unknown' }
  if (!publicHost(domain) || isTestDomain(domain)) return empty
  const home = `https://${domain}/`
  const page = await fetchPublic(home, 'text/html')
  let html = ''
  if (page && /html/i.test(page.response.headers.get('content-type') ?? '')) {
    html = decoder.decode((await readUpTo(page.response, MAX_HTML)).bytes)
  }
  const base = page?.url ?? home
  return {
    reachable: !!page,
    name: pageName(html),
    color: pageColor(html),
    icon: await findIcon(html, base),
    tracker: !page ? 'unknown' : loadsTracker(html, base, tracker.host, tracker.siteId) ? 'found' : 'not-found',
  }
}

interface IconRow {
  type: string
  data: string
  hash: string
  fetched_at: number
}

export interface StoredIcon extends FoundIcon {
  fetchedAt: number
}

export async function getIcon(ctx: Context, siteId: string): Promise<StoredIcon | null> {
  const [row] = await ctx.storage.query<IconRow>(
    'SELECT type, data, hash, fetched_at FROM site_icons WHERE site_id = ?',
    [siteId],
  )
  return row ? { type: row.type, bytes: fromBase64(row.data), hash: row.hash, fetchedAt: row.fetched_at } : null
}

/** Stores the icon (base64 text, so every database holds it the same way) and notes its hash on the site. */
async function saveIcon(ctx: Context, siteId: string, icon: FoundIcon): Promise<void> {
  const now = ctx.now()
  await ctx.storage.batch([
    {
      sql: `INSERT INTO site_icons (site_id, type, data, hash, fetched_at) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (site_id) DO UPDATE SET type = excluded.type, data = excluded.data, hash = excluded.hash,
              fetched_at = excluded.fetched_at`,
      params: [siteId, icon.type, toBase64(icon.bytes), icon.hash, now],
    },
    { sql: 'UPDATE sites SET icon_hash = ? WHERE id = ?', params: [icon.hash, siteId] },
  ])
}

const dataUrl = (icon: FoundIcon): string => `data:${icon.type};base64,${toBase64(icon.bytes)}`

const trackerOf = (request: Request, siteId: string): { host: string | null; siteId: string } => ({
  host: new URL(request.url).host,
  siteId,
})

/** What reading the site's page finds against what is stored. Changes nothing. */
export async function previewSync(site: SiteRecord, request: Request): Promise<SyncPreview> {
  if (isTestDomain(site.domain)) return { skipped: 'test-site', reachable: false, tracker: 'unknown', changes: [] }
  const reading = await readSite(site.domain, trackerOf(request, site.id))
  const changes: SyncChange[] = []
  if (reading.name !== null) {
    changes.push({
      field: 'name',
      current: site.name,
      found: reading.name,
      changed: reading.name !== site.name,
      manual: !site.nameSynced && site.name !== site.domain,
    })
  }
  if (reading.color !== null) {
    changes.push({ field: 'color', current: site.color, found: reading.color, changed: reading.color !== site.color })
  }
  if (reading.icon) {
    changes.push({
      field: 'icon',
      current: site.iconHash,
      found: dataUrl(reading.icon),
      changed: reading.icon.hash !== site.iconHash,
    })
  }
  return { reachable: reading.reachable, tracker: reading.tracker, changes }
}

/**
 * Reads the page again and takes over the chosen fields. The values come from the page, never from the request, so a
 * caller cannot put its own bytes into an icon. Fields the page does not have are left alone.
 */
export async function applySync(
  ctx: Context,
  site: SiteRecord,
  fields: unknown,
  request: Request,
): Promise<{ site: SiteRecord; applied: SyncField[] }> {
  if (!Array.isArray(fields) || fields.length === 0 || !fields.every((f) => SYNC_FIELDS.includes(f as SyncField))) {
    throw new AnalytikError(`fields must be a list of ${SYNC_FIELDS.join(', ')}`)
  }
  if (isTestDomain(site.domain)) throw new AnalytikError('a generated test site has no website to sync with')
  const reading = await readSite(site.domain, trackerOf(request, site.id))
  if (!reading.reachable) throw new AnalytikError('the website could not be read', 502)
  const applied: SyncField[] = []
  if (fields.includes('name') && reading.name !== null) {
    await ctx.storage.run('UPDATE sites SET name = ?, name_synced = 1 WHERE id = ?', [reading.name, site.id])
    applied.push('name')
  }
  if (fields.includes('color') && reading.color !== null) {
    await ctx.storage.run('UPDATE sites SET color = ? WHERE id = ?', [reading.color, site.id])
    applied.push('color')
  }
  if (fields.includes('icon') && reading.icon) {
    await saveIcon(ctx, site.id, reading.icon)
    applied.push('icon')
  }
  return { site: await requireSite(ctx, site.id), applied }
}

const iconResponse = (icon: StoredIcon): Response =>
  new Response(icon.bytes as Uint8Array<ArrayBuffer>, {
    headers: {
      'content-type': icon.type,
      'cache-control': 'private, max-age=86400',
      etag: `"${icon.hash}"`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  })

const refreshing = new Set<string>()

/** Fetches the icon again without anyone waiting for it; a failure keeps the stored one. */
async function refreshIcon(ctx: Context, site: SiteRecord, request: Request): Promise<boolean> {
  if (refreshing.has(site.id)) return false
  refreshing.add(site.id)
  try {
    const reading = await readSite(site.domain, trackerOf(request, site.id))
    if (reading.icon) await saveIcon(ctx, site.id, reading.icon)
    return !!reading.icon
  } finally {
    refreshing.delete(site.id)
  }
}

/**
 * The site's icon from the copy the server stored. A site that has none is read once, and not again for an hour
 * if that finds nothing. An icon older than 30 days is returned at once while a fresh one is fetched behind it.
 */
export async function siteIcon(ctx: Context, site: SiteRecord, request: Request): Promise<Response | null> {
  if (isTestDomain(site.domain)) return null
  const stored = await getIcon(ctx, site.id)
  // At most one try an hour per site, so a site that cannot be read is not asked on every request.
  const due = (): boolean => {
    const last = ctx.syncAttempts.get(site.id)
    if (last !== undefined && ctx.now() - last < RETRY_AFTER) return false
    ctx.syncAttempts.set(site.id, ctx.now())
    return true
  }
  if (stored) {
    if (ctx.now() - stored.fetchedAt > ICON_MAX_AGE && due())
      void refreshIcon(ctx, site, request).catch(() => undefined)
    return iconResponse(stored)
  }
  if (!due() || !(await refreshIcon(ctx, site, request))) return null
  const saved = await getIcon(ctx, site.id)
  return saved ? iconResponse(saved) : null
}
