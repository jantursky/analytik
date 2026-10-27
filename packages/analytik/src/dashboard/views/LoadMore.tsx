import type { Paged } from '../data'

export function LoadMore({ list }: { list: Paged<unknown> }) {
  if (!list.hasMore) return null
  return (
    <button type="button" className="analytik-button analytik-more" onClick={list.loadMore} disabled={list.loadingMore}>
      {list.loadingMore ? 'Loading…' : 'Load more'}
    </button>
  )
}
