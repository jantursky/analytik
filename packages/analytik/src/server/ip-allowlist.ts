import { AllowlistError, normalizeAllowlist as normalize } from '../shared/ip-allowlist'
import { AnalytikError } from './context'

export { allowedByList, normalizeEntry, parseAddress } from '../shared/ip-allowlist'

/** Checks a whole list from a request; a problem is a 400 that names the entry. */
export function normalizeAllowlist(value: unknown): string[] {
  try {
    return normalize(value)
  } catch (error) {
    if (error instanceof AllowlistError) throw new AnalytikError(error.message)
    throw error
  }
}
