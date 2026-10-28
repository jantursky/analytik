import type { TimeseriesPoint } from '../../shared/types'
import { useDashboard } from '../context'
import { t } from '../i18n'

/** True when a comparison was asked for and the earlier period recorded nothing at all. */
export function comparisonIsEmpty(points: TimeseriesPoint[]): boolean {
  const earlier = points.flatMap((p) => (p.previous ? [p.previous] : []))
  return (
    earlier.length > 0 &&
    earlier.every((p) => p.visitors + p.sessions + p.pageviews + p.orders === 0 && p.revenue === 0)
  )
}

/** Says so under a chart whose comparison period has no data, instead of drawing a flat line as if it were a result. */
export function ComparisonNote({ points }: { points: TimeseriesPoint[] }) {
  const { compare } = useDashboard()
  if (!compare || !comparisonIsEmpty(points)) return null
  return <p className="analytik-compare-note">{t('No data in the comparison period')}</p>
}
