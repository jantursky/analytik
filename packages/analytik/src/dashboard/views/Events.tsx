import { useState } from 'react'

import type { EventType } from '../../shared/types'
import type { EventRow } from '../api'
import { requestKey, useDashboard } from '../context'
import { CopyPageUrl } from '../copy-id'
import { formatDateTime } from '../format'
import { msg, t } from '../i18n'
import { View } from '../ui/motion'
import { BreakdownCard } from './Breakdown'
import { VisitorCell } from './cells'
import { type Column, DataTable } from './DataTable'
import { SessionDialog, shortId } from './Sessions'

const TYPES: { value: EventType; label: string }[] = [
  { value: 'pageview', label: msg('Pageviews') },
  { value: 'goal', label: msg('Goals') },
  { value: 'outbound', label: msg('Outbound links') },
  { value: 'revenue', label: msg('Revenue') },
  { value: 'identify', label: msg('Sign-ins') },
]

export function Events() {
  const { client, site, query, filters } = useDashboard()
  const [selected, setSelected] = useState<string | null>(null)
  const name = filters.goal ?? filters.event
  const columns: Column<EventRow>[] = [
    { key: 'time', label: t('Time'), sort: 'time', render: (e) => formatDateTime(e.ts, site.timezone) },
    {
      key: 'type',
      label: t('Type'),
      sort: 'type',
      render: (e) => (
        <span className="analytik-badge" data-type={e.type}>
          {e.type}
        </span>
      ),
    },
    { key: 'name', label: t('Name'), sort: 'name', render: (e) => e.name ?? <span className="analytik-muted">—</span> },
    {
      key: 'page',
      label: t('Page'),
      sort: 'page',
      render: (e) => (
        <>
          <span className="analytik-mono">{e.path ?? '—'}</span>
          <CopyPageUrl target={e.path} />
        </>
      ),
    },
    { key: 'visitor', label: t('Visitor'), render: (e) => <VisitorCell id={e.visitorId} /> },
  ]
  return (
    <View>
      <BreakdownCard title={t('Goals and events')} dimensions={['goal', 'event', 'outbound']} limit={50} />
      <DataTable
        title={name ? t('“{name}” events', { name }) : t('Events')}
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
        searchLabel={t('Search names and pages')}
        empty={t('No events in this period')}
        filters={[
          {
            key: 'type',
            label: t('Type'),
            options: [{ value: '', label: t('All types') }, ...TYPES.map((o) => ({ ...o, label: t(o.label) }))],
          },
          { key: 'visitor', label: t('Visitor'), format: shortId },
        ]}
        onOpen={(e) => setSelected(e.sessionId)}
        openLabel={(e) =>
          t('Open the visit with this {type} at {time}', { type: e.type, time: formatDateTime(e.ts, site.timezone) })
        }
      />
      <SessionDialog sessionId={selected} onClose={() => setSelected(null)} />
    </View>
  )
}
