/** An address as bytes: 4 for IPv4, 16 for IPv6. */
type Bytes = readonly number[]

/** A problem with an entry or the list, worded for the person who typed it. */
export class AllowlistError extends Error {}

export const MAX_ALLOWLIST = 20
const MAX_ENTRY_LENGTH = 60

const V4_PART = /^(0|[1-9]\d{0,2})$/

function parseV4(text: string): number[] | null {
  const parts = text.split('.')
  if (parts.length !== 4) return null
  const bytes: number[] = []
  for (const part of parts) {
    if (!V4_PART.test(part) || Number(part) > 255) return null
    bytes.push(Number(part))
  }
  return bytes
}

function parseV6(text: string): number[] | null {
  if (text.includes('%') || !text.includes(':')) return null
  let tail: number[] = []
  let head = text
  // A dotted IPv4 tail such as `::ffff:192.0.2.1` stands for the last two groups.
  const dot = text.lastIndexOf('.')
  if (dot !== -1) {
    const colon = text.lastIndexOf(':')
    const v4 = parseV4(text.slice(colon + 1))
    if (!v4) return null
    tail = [(v4[0] ?? 0) * 256 + (v4[1] ?? 0), (v4[2] ?? 0) * 256 + (v4[3] ?? 0)]
    head = `${text.slice(0, colon + 1)}0:0`
  }
  const halves = head.split('::')
  if (halves.length > 2) return null
  const group = (part: string): number[] | null => {
    if (part === '') return []
    const values: number[] = []
    for (const hex of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/i.test(hex)) return null
      values.push(Number.parseInt(hex, 16))
    }
    return values
  }
  const left = group(halves[0] ?? '')
  const right = halves.length === 2 ? group(halves[1] ?? '') : []
  if (!left || !right) return null
  let groups: number[]
  if (halves.length === 2) {
    const missing = 8 - left.length - right.length
    if (missing < 1) return null
    groups = [...left, ...Array.from({ length: missing }, () => 0), ...right]
  } else {
    groups = left
  }
  if (groups.length !== 8) return null
  if (tail.length === 2) groups = [...groups.slice(0, 6), ...tail]
  return groups.flatMap((value) => [value >> 8, value & 255])
}

const isMappedV4 = (bytes: Bytes): boolean =>
  bytes.length === 16 && bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 255 && bytes[11] === 255

/** Reads an IPv4 or IPv6 address. An IPv4-mapped IPv6 address becomes the IPv4 address it carries. */
export function parseAddress(text: string): Bytes | null {
  const trimmed = text.trim()
  const bytes = parseV4(trimmed) ?? parseV6(trimmed)
  if (!bytes) return null
  return isMappedV4(bytes) ? bytes.slice(12) : bytes
}

function mask(bytes: Bytes, prefix: number): number[] {
  return bytes.map((byte, index) => {
    const bits = Math.max(0, Math.min(8, prefix - index * 8))
    return byte & (bits === 0 ? 0 : (0xff << (8 - bits)) & 0xff)
  })
}

function formatV6(bytes: Bytes): string {
  const groups = Array.from({ length: 8 }, (_, i) => ((bytes[i * 2] ?? 0) << 8) | (bytes[i * 2 + 1] ?? 0))
  let best = { start: -1, length: 0 }
  for (let i = 0; i < 8;) {
    if (groups[i] !== 0) {
      i++
      continue
    }
    let end = i
    while (end < 8 && groups[end] === 0) end++
    if (end - i > best.length) best = { start: i, length: end - i }
    i = end
  }
  const hex = groups.map((group) => group.toString(16))
  if (best.length < 2) return hex.join(':')
  return `${hex.slice(0, best.start).join(':')}::${hex.slice(best.start + best.length).join(':')}`
}

const format = (bytes: Bytes): string => (bytes.length === 4 ? bytes.join('.') : formatV6(bytes))

/**
 * Checks one entry and returns it in canonical form: network bits only, IPv6 compressed and lowercase, no prefix when it
 * covers a single address. Throws a 400 that names the entry.
 */
export function normalizeEntry(entry: string): string {
  const text = entry.trim()
  const fail = (reason: string): never => {
    throw new AllowlistError(`"${text.slice(0, MAX_ENTRY_LENGTH)}" is not allowed: ${reason}`)
  }
  if (text === '' || text.length > MAX_ENTRY_LENGTH)
    return fail('enter an IPv4 or IPv6 address or a range like 203.0.113.0/24')
  const [address = '', prefixText, ...rest] = text.split('/')
  if (rest.length > 0) return fail('use one slash, as in 203.0.113.0/24')
  const raw = parseV4(address) ?? parseV6(address)
  if (!raw) return fail('not an IPv4 or IPv6 address')
  const mapped = isMappedV4(raw)
  const bytes = mapped ? raw.slice(12) : raw
  const full = bytes.length * 8
  let prefix = full
  if (prefixText !== undefined) {
    if (!/^\d{1,3}$/.test(prefixText)) return fail('the prefix must be a whole number')
    prefix = Number(prefixText)
    // A prefix on a mapped address counts bits of the 128 it was written with.
    if (mapped) {
      if (prefix < 96) return fail('write an IPv4 range instead, such as 192.0.2.0/24')
      prefix -= 96
    }
    if (prefix > full) return fail(`the prefix must be from 0 to ${full}`)
  }
  const network = mask(bytes, prefix)
  return prefix === full ? format(network) : `${format(network)}/${prefix}`
}

/** Checks a whole list from a request: text entries, canonical form, duplicates dropped, at most 20. */
export function normalizeAllowlist(value: unknown): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new AllowlistError('ipAllowlist must be a list of addresses or ranges')
  const entries: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') throw new AllowlistError('ipAllowlist entries must be text')
    const entry = normalizeEntry(item)
    if (!entries.includes(entry)) entries.push(entry)
  }
  if (entries.length > MAX_ALLOWLIST) throw new AllowlistError(`ipAllowlist can hold at most ${MAX_ALLOWLIST} entries`)
  return entries
}

/** Whether an address falls inside any entry of a normalised list. An unknown or unreadable address never does. */
export function allowedByList(list: readonly string[], ip: string | null | undefined): boolean {
  const address = ip ? parseAddress(ip) : null
  if (!address) return false
  return list.some((entry) => {
    const [network = '', prefixText] = entry.split('/')
    const base = parseAddress(network)
    if (base?.length !== address.length) return false
    const prefix = prefixText === undefined ? base.length * 8 : Number(prefixText)
    const a = mask(address, prefix)
    const b = mask(base, prefix)
    return a.every((byte, index) => byte === b[index])
  })
}
