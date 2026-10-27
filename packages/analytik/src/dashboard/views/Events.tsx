import { useState } from 'react'

import type { EventType } from '../../shared/types'
import type { EventRow } from '../api'
import { requestKey, useDashboard } from '../context'
import { formatDateTime } from '../format'
import { View } from '../ui/motion'
import { BreakdownCard } from './Breakdown'
import { VisitorCell } from './cells'
import { type Column, DataTable } from './DataTable'
import { SessionDialog, shortId } from './Sessions'

const TYPES: { value: EventType; label: string }[] = [
  { value: 'pageview', label: 'Pageviews' },
  { value: 'goal', label: 'Goals' },
  { value: 'outbound', label: 'Outbound links' },
  { value: 'revenue', label: 'Revenue' },
  { value: 'identify', label: 'Sign-ins' },
]

export function Events() {
  const { client, site, query, filters } = useDashboard()
  const [selected, setSelected] = useState<string | null>(null)
  const name = filters.goal ?? filters.event
  const columns: Column<EventRow>[] = [
    { key: 'time', label: 'Time', sort: 'time', render: (e) => formatDateTime(e.ts, site.timezone) },
    {
      key: 'type',
      label: 'Type',
      sort: 'type',
      render: (e) => (
        <span className="analytik-badge" data-type={e.type}>
          {e.type}
        </span>
      ),
    },
    { key: 'name', label: 'Name', sort: 'name', render: (e) => e.name ?? <span className="analytik-muted">—</span> },
    { key: 'page', label: 'Page', sort: 'page', render: (e) => <span className="analytik-mono">{e.path ?? '—'}</span> },
    { key: 'visitor', label: 'Visitor', render: (e) => <VisitorCell id={e.visitorId} /> },
  ]
  return (
    <View>
      <BreakdownCard title="Goals and events" dimensions={['goal', 'event', 'outbound']} limit={50} />
      <DataTable
        title={name ? `“${name}” events` : 'Events'}
        columns={columns}
        basis={requestKey('events', site.id, query.filters, name)}
        load={({ filters: picked, ...request }) =>
          client.events(site.id, {
            ...query,
            ...request,
            name,
            type: picked.type as EventType | undefined,
            visitor: picked.visitor,
          })
        }
        rowKey={(e) => e.id}
        searchLabel="Search names and pages"
        empty="No events in this period"
        filters={[
          { key: 'type', label: 'Type', options: [{ value: '', label: 'All types' }, ...TYPES] },
          { key: 'visitor', label: 'Visitor', format: shortId },
        ]}
        onOpen={(e) => setSelected(e.sessionId)}
        openLabel={(e) => `Open the visit with this ${e.type} at ${formatDateTime(e.ts, site.timezone)}`}
      />
      <SessionDialog sessionId={selected} onClose={() => setSelected(null)} />
    </View>
  )
}
