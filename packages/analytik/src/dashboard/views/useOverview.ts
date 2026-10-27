import type { Overview, TimeseriesPoint } from '../../shared/types'
import { requestKey, useDashboard } from '../context'
import { useResource } from '../data'

/** Loads the overview numbers and the timeseries for the current query. */
export function useOverview() {
  const { client, site, query } = useDashboard()
  const overview = useResource<Overview>(requestKey('overview', site.id, query), () => client.overview(site.id, query))
  const series = useResource<TimeseriesPoint[]>(requestKey('timeseries', site.id, query), () =>
    client.timeseries(site.id, query),
  )
  return { overview, series }
}
