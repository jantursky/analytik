import type { EventRow } from '../api'
import { requestKey, useDashboard } from '../context'
import { usePaged } from '../data'
import { formatDateTime } from '../format'
import { Card, Status } from '../ui'
import { View } from '../ui/motion'
import { BreakdownCard } from './Breakdown'
import { LoadMore } from './LoadMore'

export function Events() {
  const { client, site, query, filters } = useDashboard()
  const name = filters.goal ?? filters.event
  const events = usePaged<EventRow>(requestKey('events', site.id, query, name), (cursor) =>
    client.events(site.id, { ...query, name, cursor }),
  )
  return (
    <View>
      <BreakdownCard title="Goals and events" dimensions={['goal', 'event', 'outbound']} limit={50} />
      <Card title={name ? `Recent “${name}” events` : 'Recent events'}>
        <Status loading={events.loading} error={events.error}>
          {events.items.length ? (
            <div className="analytik-table-wrap">
              <table className="analytik-table">
                <thead>
                  <tr>
                    <th scope="col">Time</th>
                    <th scope="col">Type</th>
                    <th scope="col">Name</th>
                    <th scope="col">Page</th>
                  </tr>
                </thead>
                <tbody>
                  {events.items.map((e) => (
                    <tr key={e.id}>
                      <td>{formatDateTime(e.ts, site.timezone)}</td>
                      <td>{e.type}</td>
                      <td>{e.name ?? '—'}</td>
                      <td className="analytik-mono">{e.path ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="analytik-empty">No events in this period</p>
          )}
          <LoadMore list={events} />
        </Status>
      </Card>
    </View>
  )
}
