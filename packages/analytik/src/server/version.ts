import { version } from '../../package.json'
import type { VersionInfo } from '../shared/types'
import type { Context } from './context'

const REGISTRY = 'https://registry.npmjs.org/analytik/latest'
const FOUND_MS = 6 * 60 * 60 * 1000
const MISSED_MS = 10 * 60 * 1000
const TIMEOUT_MS = 3000

let cached: { at: number; latest: string | null } | undefined

/**
 * The running version and the newest one on npm, for the dashboard's update notice. The registry is asked from the
 * server (never the browser) at most every six hours per instance, and not at all with `updateCheck: false`.
 */
export async function versionInfo(ctx: Context): Promise<VersionInfo> {
  if (!ctx.updateCheck) return { current: version, latest: null }
  const now = ctx.now()
  if (!cached || now - cached.at > (cached.latest ? FOUND_MS : MISSED_MS)) {
    let latest: string | null = null
    try {
      const response = await fetch(REGISTRY, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      const body = response.ok ? ((await response.json()) as { version?: unknown }) : null
      if (typeof body?.version === 'string') latest = body.version
    } catch {
      // Offline or blocked: no notice, and a retry in ten minutes.
    }
    cached = { at: now, latest }
  }
  return { current: version, latest: cached.latest }
}

/** Forgets the registry's answer; for tests. */
export function resetVersionCache(): void {
  cached = undefined
}
