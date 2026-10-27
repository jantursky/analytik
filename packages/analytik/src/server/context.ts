import { cryptoRandom, type RandomBytes } from '../shared/ids'
import type { PrivacyMode } from '../shared/types'
import type { Storage } from '../storage/types'
import { clientIpFrom } from './request'
import type { AdminAuth, AllowedOrigins, CreateAnalytikOptions, Geo } from './types'

/** Everything the handlers share; built once per `createAnalytik()`. */
export interface Context {
  storage: Storage
  now: () => number
  random: RandomBytes
  admin: AdminAuth | undefined
  basePath: string
  defaultMode: PrivacyMode
  keepQuery: string[]
  respectDoNotTrack: boolean
  allowedOrigins: AllowedOrigins
  geo: ((request: Request) => Geo | null | Promise<Geo | null>) | undefined
  clientIp: (request: Request) => string | null
  debug: boolean
  updateCheck: boolean
  /** Month salts this instance has loaded, so the hot path doesn't query them on every event. */
  salts: Map<string, string>
  /** When retention was last enforced per site, so it runs at most hourly per instance. */
  retentionRuns: Map<string, number>
}

/** Fails at startup instead of serving a login anyone can pass, or session cookies anyone can forge. */
function checkAdmin(admin: AdminAuth | undefined): void {
  if (!admin || !('password' in admin) || !('secret' in admin)) return
  if (typeof admin.password !== 'string' || admin.password === '') {
    throw new Error('analytik: admin.password is empty. Set it (e.g. from ADMIN_PASSWORD).')
  }
  if (typeof admin.secret !== 'string' || admin.secret.length < 32) {
    throw new Error(
      'analytik: admin.secret must be at least 32 characters (e.g. SESSION_SECRET from `openssl rand -hex 32`).',
    )
  }
}

export function createContext(options: CreateAnalytikOptions): Context {
  checkAdmin(options.admin)
  const trustProxy = options.trustProxy ?? 'auto'
  return {
    storage: options.storage,
    now: options.now ?? Date.now,
    random: options.random ?? cryptoRandom,
    admin: options.admin,
    basePath: (options.basePath ?? '/api').replace(/\/+$/, ''),
    defaultMode: options.privacy?.mode ?? 'strict',
    keepQuery: (options.privacy?.keepQuery ?? []).map((key) => key.toLowerCase()),
    respectDoNotTrack: options.privacy?.respectDoNotTrack ?? true,
    allowedOrigins: options.allowedOrigins ?? 'site-domains',
    geo: options.geo,
    clientIp: options.clientIp ?? ((request) => clientIpFrom(request, trustProxy)),
    debug: options.debug === true,
    updateCheck: options.updateCheck !== false,
    salts: new Map(),
    retentionRuns: new Map(),
  }
}

/** An error with an HTTP status; the routes turn it into `{ error }` JSON. */
export class AnalytikError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 429 = 400,
  ) {
    super(message)
    this.name = 'AnalytikError'
  }
}
