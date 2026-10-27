/** Icons are small; anything bigger is not one. */
const MAX_BYTES = 100_000
const MAX_HTML = 200_000
const TIMEOUT_MS = 4000

/** A public host name: not an address, not `localhost`, not a name that only resolves inside a network. */
function publicHost(domain: string): boolean {
  return (
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain) &&
    !/^\d+(\.\d+)*$/.test(domain) &&
    !/\.(local|localhost|internal|lan|home|corp)$/.test(domain)
  )
}

async function get(url: string): Promise<Response | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'text/html,image/*' },
    })
    return response.ok ? response : null
  } catch {
    return null
  }
}

/** The `href` of each `<link rel="icon">` (also `shortcut icon` and `apple-touch-icon`) in a page, in the order written. */
function iconLinks(html: string): string[] {
  const links: { href: string; rank: number }[] = []
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = /\brel\s*=\s*["']?([^"'>]*)/i.exec(tag)?.[1]?.toLowerCase() ?? ''
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]
    if (!href || !/\bicon\b/.test(rel.replace('apple-touch-icon', 'touch icon'))) continue
    // A plain icon is the right size for a tile; the big touch icons come last.
    links.push({ href, rank: rel.includes('apple') ? 1 : 0 })
  }
  return links.sort((a, b) => a.rank - b.rank).map((link) => link.href)
}

/**
 * The icon of a tracked site, fetched by the server so the browser never contacts the site (or a third-party icon
 * service) just because someone opened the dashboard. Looks for `<link rel="icon">` on the home page, then tries
 * `/favicon.ico`; null when there is none. Only public host names are asked, over https.
 */
export async function siteFavicon(domain: string): Promise<Response | null> {
  if (!publicHost(domain)) return null
  const home = `https://${domain}/`
  const page = await get(home)
  const html =
    page && /html/i.test(page.headers.get('content-type') ?? '') ? (await page.text()).slice(0, MAX_HTML) : ''
  const resolve = (href: string): string[] => {
    try {
      return [new URL(href, page?.url ?? home).href]
    } catch {
      return []
    }
  }
  const candidates = [...iconLinks(html).flatMap(resolve), `${home}favicon.ico`]
  for (const url of new Set(candidates)) {
    if (!url.startsWith('https://')) continue
    const response = await get(url)
    const type = response?.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
    if (!response || !(type.startsWith('image/') || (type === 'application/octet-stream' && url.endsWith('.ico'))))
      continue
    const body = await response.arrayBuffer()
    if (body.byteLength === 0 || body.byteLength > MAX_BYTES) continue
    return new Response(body, {
      headers: {
        'content-type': type === 'application/octet-stream' ? 'image/x-icon' : type,
        'cache-control': 'private, max-age=86400',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      },
    })
  }
  return null
}
