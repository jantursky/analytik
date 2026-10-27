import { use, useEffect } from 'react'

import { NAVIGATE, patchHistory } from '../tracker/history'
import type { Analytik } from '../tracker/types'
import { AnalytikContext } from './context'

/** A router location: React Router's `useLocation()`, TanStack Router's `useLocation()`, or a path string. */
export type LocationLike = string | { pathname: string; search?: unknown; href?: string }

/** The client from the nearest `AnalytikProvider`, or a no-op client outside one. */
export function useAnalytik(): Analytik {
  return use(AnalytikContext)
}

function locationKey(location: LocationLike): string {
  if (typeof location === 'string') return location
  const { pathname, search, href } = location
  return href ?? pathname + (typeof search === 'string' ? search : JSON.stringify(search ?? ''))
}

/**
 * Records a pageview whenever `location` changes, or, without it, on mount and on every History API navigation.
 * Repeats of the last recorded URL are skipped, so it is safe next to the client's own `autoPageviews`.
 */
export function useTrackPageviews(location?: LocationLike): void {
  const analytik = useAnalytik()
  const key = location == null ? null : locationKey(location)

  useEffect(() => {
    analytik.pageview()
    if (key != null) return
    patchHistory()
    const track = (): void => analytik.pageview()
    addEventListener(NAVIGATE, track)
    addEventListener('popstate', track)
    return () => {
      removeEventListener(NAVIGATE, track)
      removeEventListener('popstate', track)
    }
  }, [analytik, key])
}
