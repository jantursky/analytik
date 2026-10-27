import { useCallback, useEffect, useEffectEvent, useState } from 'react'

import type { Page } from '../shared/types'

export interface Resource<T> {
  /** The latest result, kept while a new key loads. */
  data: T | undefined
  error: Error | undefined
  /** True until the result for the current key arrives. */
  loading: boolean
  reload: () => void
}

const toError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)))

/** Loads data whenever `key` changes; late responses for an old key are ignored. */
export function useResource<T>(key: string, load: () => Promise<T>): Resource<T> {
  const [state, setState] = useState<{ key: string; data?: T; error?: Error }>()
  const [version, setVersion] = useState(0)
  const run = useEffectEvent(load)

  useEffect(() => {
    let current = true
    run().then(
      (data) => current && setState({ key, data }),
      (error: unknown) => current && setState((s) => ({ key, data: s?.data, error: toError(error) })),
    )
    return () => {
      current = false
    }
  }, [key, version])

  const reload = useCallback(() => setVersion((v) => v + 1), [])
  const fresh = state?.key === key
  return { data: state?.data, error: fresh ? state.error : undefined, loading: !fresh, reload }
}

export interface Paged<T> {
  items: T[]
  loading: boolean
  error: Error | undefined
  hasMore: boolean
  /** True while a further page loads. */
  loadingMore: boolean
  loadMore: () => void
}

interface PagedState<T> {
  key: string
  items: T[]
  next: string | null
  error?: Error
}

/** Cursor-paged list: the first page loads whenever `key` changes, `loadMore()` appends the next. */
export function usePaged<T>(key: string, load: (cursor: string | null) => Promise<Page<T>>): Paged<T> {
  const [state, setState] = useState<PagedState<T>>()
  const [loadingMore, setLoadingMore] = useState(false)
  const run = useEffectEvent(load)

  useEffect(() => {
    let current = true
    run(null).then(
      (page) => current && setState({ key, items: page.items, next: page.nextCursor }),
      (error: unknown) => current && setState({ key, items: [], next: null, error: toError(error) }),
    )
    return () => {
      current = false
    }
  }, [key])

  const fresh = state?.key === key ? state : undefined
  const loadMore = (): void => {
    if (!fresh?.next) return
    setLoadingMore(true)
    load(fresh.next)
      .then(
        (page) =>
          setState((s) => (s?.key === key ? { key, items: [...s.items, ...page.items], next: page.nextCursor } : s)),
        (error: unknown) => setState((s) => s && { ...s, error: toError(error) }),
      )
      .finally(() => setLoadingMore(false))
  }
  return {
    items: fresh?.items ?? [],
    loading: !fresh,
    error: fresh?.error,
    hasMore: !!fresh?.next,
    loadingMore,
    loadMore,
  }
}
