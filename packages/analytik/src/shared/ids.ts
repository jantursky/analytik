/** Fills a byte array with random values. Injectable so tests get stable ids. */
export type RandomBytes = (size: number) => Uint8Array

export const cryptoRandom: RandomBytes = (size) => crypto.getRandomValues(new Uint8Array(size))

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

/** A lowercase alphanumeric id with `length` characters. */
export function randomId(length = 16, random: RandomBytes = cryptoRandom): string {
  let id = ''
  // 252 is the largest multiple of 36 below 256; rejecting the rest keeps every character equally likely.
  while (id.length < length) {
    for (const byte of random(length)) {
      if (byte < 252 && id.length < length) id += ALPHABET.charAt(byte % 36)
    }
  }
  return id
}

/** Site ids: generated ones are 12 characters, but hand-picked ones like `demo` are fine too. */
export function isSiteId(value: unknown): value is string {
  return typeof value === 'string' && /^[\w-]{1,64}$/.test(value)
}

/** Ids from the tracker and from checkout metadata: 8 to 64 word characters or dashes. */
export function isId(value: unknown): value is string {
  return typeof value === 'string' && /^[\w-]{8,64}$/.test(value)
}
