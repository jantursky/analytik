/** Keys that may hold personal data (`?email=` on a return page). They are removed in the browser, even if kept. */
const PRIVATE_KEY =
  /^(e-?mail|name|phone|pass(word)?|secret|(api_|license_)?key|license|(access_|id_)?token|auth|code)$/i

/** Campaign tags, and the ids payment providers add to return URLs so a payment can be claimed for the visit. */
const ALWAYS_KEPT = /^(utm_\w+|ref|source|payment_id|session_id|subscription_id)$/

/**
 * Drops the fragment and every query parameter except campaign keys, payment return ids and `keep`.
 * Private parameters are dropped even when listed in `keep`.
 */
export function cleanUrl(href: string, keep: readonly string[] = []): string {
  try {
    const url = new URL(href)
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (PRIVATE_KEY.test(key) || !(ALWAYS_KEPT.test(key) || keep.includes(key))) url.searchParams.delete(key)
    }
    return url.href
  } catch {
    return href
  }
}

/** A referrer is reduced to origin and path: its query belongs to another site and may carry personal data. */
export function cleanReferrer(referrer: string): string | undefined {
  try {
    const url = new URL(referrer)
    return url.origin + url.pathname
  } catch {
    return undefined
  }
}

export function isLocalhost(hostname: string, protocol: string): boolean {
  return protocol === 'file:' || /^(localhost|127(\.\d+){3}|0\.0\.0\.0|\[::1\])$|\.local(host)?$/.test(hostname)
}

/** Whether a link leaves the site: another host that is not `domain` or one of its subdomains. */
export function isOutbound(link: URL, hostname: string, domain?: string): boolean {
  const host = link.hostname
  return (
    /^https?:$/.test(link.protocol) &&
    host !== hostname &&
    !(domain && (host === domain || host.endsWith('.' + domain)))
  )
}
