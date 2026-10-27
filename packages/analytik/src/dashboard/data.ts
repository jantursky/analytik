import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { Realtime } from '../shared/types'

export interface Resource<T> {
  /** The latest result, kept while a new key loads. */
  data: T | undefined
  error: Error | undefined
  /** True until the result for the current key arrives. */
  loading: boolean
  reload: () => void
}

const toError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)))

/**
 * A stable function that always calls the latest `fn`, for effects that shouldn't rerun when it changes. React's own
 * `useEffectEvent` only exists from 19.2, and the dashboard supports every React 19.
 */
function useLatest<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn)
  useLayoutEffect(() => {
    ref.current = fn
  })
  return useCallback((...args: A) => ref.current(...args), [])
}

/** Loads data whenever `key` changes; late responses for an old key are ignored. */
export function useResource<T>(key: string, load: () => Promise<T>): Resource<T> {
  const [state, setState] = useState<{ key: string; data?: T; error?: Error }>()
  const [version, setVersion] = useState(0)
  const run = useLatest(load)

  useEffect(() => {
    let current = true
    run().then(
      (data) => current && setState({ key, data }),
      (error: unknown) => current && setState((s) => ({ key, data: s?.data, error: toError(error) })),
    )
    return () => {
      current = false
    }
  }, [key, version, run])

  const reload = useCallback(() => setVersion((v) => v + 1), [])
  const fresh = state?.key === key
  return { data: state?.data, error: fresh ? state.error : undefined, loading: !fresh, reload }
}

/**
 * Calls `poll` every `every` ms while the page is visible. While `signature` (what the last answer showed) stays the
 * same, the wait doubles up to `max`, so a quiet site is asked less often; a change, or the tab coming back into
 * view, goes back to `every`. A hidden tab isn't polled at all.
 */
export function usePolling(poll: () => void, signature: string, every: number, max: number): void {
  const run = useLatest(poll)

  // Runs again whenever the answer changes, starting over at the short wait.
  useEffect(() => {
    let delay = every
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = (): void => {
      timer = setTimeout(() => {
        if (document.visibilityState !== 'visible') return
        run()
        delay = Math.min(delay * 2, max)
        schedule()
      }, delay)
    }
    const visibility = (): void => {
      clearTimeout(timer)
      if (document.visibilityState !== 'visible') return
      delay = every
      run()
      schedule()
    }
    schedule()
    document.addEventListener('visibilitychange', visibility)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [every, max, signature, run])
}

/** What a live answer shows, for `usePolling`: the same count, newest event and places mean nothing new happened. */
export const liveSignature = (data: Realtime | undefined): string =>
  data
    ? `${data.online}|${data.recent[0]?.ts ?? 0}|${data.locations.map((l) => `${l.sessionId}:${l.page ?? ''}`).join(',')}`
    : ''
