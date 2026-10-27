import type { PrivacyMode } from 'analytik'

export interface ModeFacts {
  mode: PrivacyMode
  title: string
  deviceStorage: string
  visitorId: string
  banner: string
  survives: string
}

export const MODES: readonly ModeFacts[] = [
  {
    mode: 'strict',
    title: 'Strict',
    deviceStorage: 'Nothing. No cookie, no localStorage, no sessionStorage.',
    visitorId: 'Server side: HMAC(monthSalt, site + IP + user agent), truncated. The IP is never stored.',
    banner: 'Not needed.',
    survives: 'Until the month ends and its salt is deleted. A visitor on a new network counts twice.',
  },
  {
    mode: 'enriched',
    title: 'Enriched',
    deviceStorage: 'A tab id (analytik_tab) in sessionStorage, written only after consent().',
    visitorId: 'The strict hash plus the tab id. Do Not Track and Global Privacy Control are honoured.',
    banner: 'After the visitor consents.',
    survives: 'The tab session. identify() and email matching work once consent was given.',
  },
  {
    mode: 'persistent',
    title: 'Persistent',
    deviceStorage: 'First-party cookies analytik_vid (1 year) and analytik_sid (30 minutes).',
    visitorId: 'A random UUID stored in the cookie.',
    banner: 'Required in the EU.',
    survives: 'Across visits, for as long as the cookie lives.',
  },
]

const toHex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')

/** The strict-mode visitor id: HMAC-SHA256 keyed with the month salt, truncated to 16 hex characters. */
export const deriveVisitorId = async (salt: string, site: string, ip: string, userAgent: string): Promise<string> => {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(salt), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${site}|${ip}|${userAgent}`))
  return toHex(signature).slice(0, 16)
}

export const randomSalt = (): string => toHex(crypto.getRandomValues(new Uint8Array(16)).buffer)

export interface DeviceStorage {
  cookies: string[]
  localStorage: string[]
  sessionStorage: string[]
}

const keysOf = (storage: Storage): string[] => {
  try {
    return Object.keys(storage)
  } catch {
    return []
  }
}

/** Names (never values) of everything this origin keeps on the device right now. */
export const EMPTY_DEVICE: DeviceStorage = { cookies: [], localStorage: [], sessionStorage: [] }

export const readDeviceStorage = (): DeviceStorage => (typeof document === 'undefined' ? EMPTY_DEVICE : read())

const read = (): DeviceStorage => ({
  cookies: document.cookie
    .split(';')
    .map((pair) => pair.split('=')[0]?.trim() ?? '')
    .filter(Boolean),
  localStorage: keysOf(window.localStorage),
  sessionStorage: keysOf(window.sessionStorage),
})
