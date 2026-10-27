import type { Geo, TrustProxy } from './types'

/** City-level coordinates, rounded to 2 decimals (about 1 km), so no precise location is stored. */
function coordinate(value: unknown, max: number): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : Number.NaN
  return Number.isFinite(number) && Math.abs(number) <= max ? Math.round(number * 100) / 100 : null
}

function header(request: Request, name: string): string | null {
  const value = request.headers.get(name)
  if (!value) return null
  try {
    return decodeURIComponent(value).slice(0, 100)
  } catch {
    return value.slice(0, 100)
  }
}

interface CloudflareProperties {
  country?: string
  region?: string
  city?: string
  latitude?: string
  longitude?: string
}

/**
 * Location from edge headers. Vercel's headers win, because a proxy in front of a Worker makes
 * Cloudflare see the proxy's location instead of the visitor's.
 */
export function geoFromRequest(request: Request): Geo | null {
  if (request.headers.has('x-vercel-ip-country')) {
    return {
      country: header(request, 'x-vercel-ip-country'),
      region: header(request, 'x-vercel-ip-country-region'),
      city: header(request, 'x-vercel-ip-city'),
      lat: coordinate(header(request, 'x-vercel-ip-latitude'), 90),
      lon: coordinate(header(request, 'x-vercel-ip-longitude'), 180),
    }
  }
  const cf = (request as Request & { cf?: CloudflareProperties }).cf
  const country = cf?.country ?? header(request, 'cf-ipcountry')
  if (!country || country === 'XX' || country === 'T1') return null
  return {
    country,
    region: cf?.region ?? null,
    city: cf?.city ?? null,
    lat: coordinate(cf?.latitude, 90),
    lon: coordinate(cf?.longitude, 180),
  }
}

const IP = /^[\da-f:.]{2,45}$/i
const PRIVATE_IP = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|f[cd]|fe80:)/i

const ip = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim()
  return trimmed && IP.test(trimmed) ? trimmed : null
}

/** The address the proxy appended last that is not a private one: entries left of it are client-supplied. */
function rightmostPublic(header: string | null): string | null {
  const entries = (header ?? '')
    .split(',')
    .map(ip)
    .filter((entry) => entry !== null)
    .reverse()
  return entries.find((entry) => !PRIVATE_IP.test(entry)) ?? entries[0] ?? null
}

const onVercel = (): boolean =>
  Boolean((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.VERCEL)

/** The client IP from the headers `trust` allows, or null. Used for hashing and rate limits only. */
export function clientIpFrom(request: Request, trust: TrustProxy): string | null {
  const headers = request.headers
  const platform =
    trust !== 'auto'
      ? trust
      : (request as Request & { cf?: unknown }).cf
        ? 'cloudflare'
        : // The header alone can be sent by anyone, so it only counts when the process runs on Vercel.
          headers.has('x-vercel-id') && onVercel()
          ? 'vercel'
          : false
  if (platform === 'cloudflare') return ip(headers.get('cf-connecting-ip'))
  if (platform === 'vercel') {
    return ip(headers.get('x-vercel-forwarded-for')?.split(',')[0]) ?? ip(headers.get('x-real-ip'))
  }
  return platform === 'forwarded' ? rightmostPublic(headers.get('x-forwarded-for')) : null
}

export function doNotTrack(request: Request): boolean {
  return request.headers.get('dnt') === '1' || request.headers.get('sec-gpc') === '1'
}

/** Reads the body as text, stopping as soon as it exceeds `limit` bytes. Returns null when it is too large. */
export async function readText(request: Request, limit: number): Promise<string | null> {
  if (Number(request.headers.get('content-length') ?? 0) > limit) return null
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}
