/** Web Crypto helpers that run unchanged on Workers, Bun, Node and in browsers. */

const encoder = new TextEncoder()

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** Throws on input that is not base64. */
export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function hmacSha256(key: string | Uint8Array<ArrayBuffer>, data: string): Promise<Uint8Array> {
  const raw = typeof key === 'string' ? encoder.encode(key) : key
  const cryptoKey = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data)))
}

export async function sha256Hex(data: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(data))))
}

/** Compares two strings in time that depends only on the length of `expected`. */
export function timingSafeEqual(actual: string, expected: string): boolean {
  let diff = actual.length ^ expected.length
  for (let index = 0; index < expected.length; index++) {
    diff |= (actual.charCodeAt(index) || 0) ^ expected.charCodeAt(index)
  }
  return diff === 0
}
