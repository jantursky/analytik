/** An IP address or a range in CIDR notation, as a numeric range that addresses can be compared against. */
export interface IpRange {
  family: 4 | 6
  /** First address of the range. */
  start: bigint
  /** Last address of the range. */
  end: bigint
  /** Prefix length: 32 or 128 for a single address. */
  prefix: number
}

/** Narrowest and widest ranges that may be ignored. A range wider than this would drop most visitors. */
export const MIN_PREFIX = { 4: 8, 6: 32 } as const

const BITS = { 4: 32, 6: 128 } as const

function parseV4(text: string): bigint | null {
  const parts = text.split('.')
  if (parts.length !== 4) return null
  let value = 0n
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255) return null
    value = (value << 8n) | BigInt(part)
  }
  return value
}

function parseV6(text: string): bigint | null {
  if (!/^[\da-f:.]+$/i.test(text) || text.split('::').length > 2) return null
  const words = (part: string): number[] | null => {
    if (part === '') return []
    const out: number[] = []
    const groups = part.split(':')
    for (const [index, group] of groups.entries()) {
      if (group.includes('.')) {
        const v4 = index === groups.length - 1 ? parseV4(group) : null
        if (v4 === null) return null
        out.push(Number(v4 >> 16n), Number(v4 & 0xffffn))
      } else if (/^[\da-f]{1,4}$/i.test(group)) out.push(Number.parseInt(group, 16))
      else return null
    }
    return out
  }
  const [head = '', rest] = text.split('::')
  const first = words(head)
  if (!first) return null
  const join = (list: number[]): bigint => list.reduce((value, word) => (value << 16n) | BigInt(word), 0n)
  if (rest === undefined) return first.length === 8 ? join(first) : null
  const last = words(rest)
  if (!last || first.length + last.length > 7) return null
  return join([...first, ...Array<number>(8 - first.length - last.length).fill(0), ...last])
}

/** `1.2.3.4`, `::ffff:1.2.3.4` (read as IPv4) or an IPv6 address; null for anything else. */
export function parseIp(text: string): { family: 4 | 6; value: bigint } | null {
  const trimmed = text.trim()
  const v4 = parseV4(trimmed)
  if (v4 !== null) return { family: 4, value: v4 }
  const v6 = parseV6(trimmed)
  if (v6 === null) return null
  // An IPv4 address on a dual-stack socket arrives as ::ffff:a.b.c.d.
  if (v6 >> 32n === 0xffffn) return { family: 4, value: v6 & 0xffffffffn }
  return { family: 6, value: v6 }
}

/**
 * Parses `203.0.113.7`, `203.0.113.0/24`, `2001:db8::/48`. Returns null for anything malformed or wider than
 * `/8` (IPv4) or `/32` (IPv6).
 */
export function parseRange(text: string): IpRange | null {
  const [address = '', length, ...extra] = text.trim().split('/')
  if (extra.length > 0) return null
  const ip = parseIp(address)
  if (!ip) return null
  const bits = BITS[ip.family]
  let prefix: number = bits
  if (length !== undefined) {
    if (!/^\d{1,3}$/.test(length)) return null
    prefix = Number(length)
    // A mapped IPv4 address written with a /n counts the 96 leading bits.
    if (ip.family === 4 && address.includes(':') && prefix >= 96) prefix -= 96
    if (prefix > bits || prefix < MIN_PREFIX[ip.family]) return null
  }
  const host = BigInt(bits - prefix)
  const start = (ip.value >> host) << host
  return { family: ip.family, start, end: start | ((1n << host) - 1n), prefix }
}

/** A matcher for a list of addresses and ranges; entries that don't parse are skipped. */
export function ipMatcher(entries: readonly string[]): (ip: string) => boolean {
  const ranges = entries.map(parseRange).filter((range): range is IpRange => range !== null)
  const exact = new Set(entries)
  return (ip) => {
    if (exact.has(ip)) return true
    const parsed = parseIp(ip)
    return (
      !!parsed &&
      ranges.some((range) => range.family === parsed.family && parsed.value >= range.start && parsed.value <= range.end)
    )
  }
}
