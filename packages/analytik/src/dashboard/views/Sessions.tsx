import { useState } from 'react'

import { CHANNELS } from '../../shared/channels'
import type { BreakdownRow, SessionSummary } from '../../shared/types'
import type { SessionDetail } from '../api'
import { requestKey, useDashboard } from '../context'
import { useResource } from '../data'
import { formatDateTime, formatDuration, formatMoney, formatNumber } from '../format'
import { msg, t } from '../i18n'
import { Card, Status } from '../ui'
import { Dialog } from '../ui/dialog'
import { View } from '../ui/motion'
import { Browser, Device, DeviceType, PathFlow, Place, Visitor, VisitorCell } from './cells'
import { type Column, DataTable } from './DataTable'

function TimelineBody({ sessionId }: { sessionId: string }) {
  const { client, site } = useDashboard()
  const detail = useResource<SessionDetail>(requestKey('session', site.id, sessionId), () =>
    client.session(site.id, sessionId),
  )
  const session = detail.data?.session
  return (
    <Status loading={detail.loading} error={detail.error}>
      {session && (
        <>
          <div className="analytik-session-head">
            <Visitor id={session.visitorId} copy={{ text: session.visitorId, label: t('Copy visitor id') }} />
            <Place country={session.country} city={session.city} />
            <Device device={session.device} browser={session.browser} />
          </div>
          <p className="analytik-muted">
            {formatDateTime(session.startedAt, site.timezone)} · {session.source} · {formatDuration(session.durationMs)}
          </p>
          <ol className="analytik-timeline">
            {detail.data?.events.map((e) => (
              <li key={e.id} data-type={e.type}>
                <span className="analytik-mono">+{formatDuration(e.ts - session.startedAt)}</span>
                <span className="analytik-badge" data-type={e.type}>
                  {e.type}
                </span>
                <span>{e.name ?? e.path ?? '—'}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </Status>
  )
}

/** Every event of one session, in order, with the time since the session started. */
export function SessionTimeline({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  return (
    <Card
      title={t('Visitor timeline')}
      actions={
        <button type="button" className="analytik-button" onClick={onClose}>
          {t('Close')}
        </button>
      }
    >
      <TimelineBody sessionId={sessionId} />
    </Card>
  )
}

/** The visitor timeline of one session in a dialog; closed while `sessionId` is null. */
export function SessionDialog({ sessionId, onClose }: { sessionId: string | null; onClose: () => void }) {
  // Keeps the last session while the dialog animates out.
  const [shown, setShown] = useState(sessionId)
  if (sessionId && sessionId !== shown) setShown(sessionId)
  return (
    <Dialog open={!!sessionId} onOpenChange={(open) => !open && onClose()} title={t('Visitor timeline')} size="wide">
      {shown && <TimelineBody sessionId={shown} />}
    </Dialog>
  )
}

const DEVICES = [msg('Desktop'), msg('Mobile'), msg('Tablet')] as const

/** Ids shown in filter chips by their last six characters, like the visitor cells. */
export const shortId = (id: string): string => id.slice(-6)

export function Sessions() {
  const { client, site, query } = useDashboard()
  const [selected, setSelected] = useState<string | null>(null)
  // The browsers seen in the period, for the browser filter.
  const browsers = useResource<BreakdownRow[]>(requestKey('browser-options', site.id, query), () =>
    client.breakdown(site.id, 'browser', query),
  )
  const columns: Column<SessionSummary>[] = [
    { key: 'visitor', label: t('Visitor'), render: (s) => <VisitorCell id={s.visitorId} /> },
    { key: 'started', label: t('Started'), sort: 'time', render: (s) => formatDateTime(s.startedAt, site.timezone) },
    {
      key: 'location',
      label: t('Location'),
      sort: 'country',
      render: (s) => <Place country={s.country} city={s.city} />,
    },
    {
      key: 'source',
      label: t('Source'),
      sort: 'source',
      render: (s) => (
        <span>
          {s.source}
          <span className="analytik-sub">{s.channel}</span>
        </span>
      ),
    },
    { key: 'device', label: t('Device'), render: (s) => <DeviceType device={s.device} /> },
    { key: 'browser', label: t('Browser'), render: (s) => <Browser browser={s.browser} os={s.os} /> },
    {
      key: 'path',
      label: t('Entry → Exit'),
      sort: 'entry',
      render: (s) => <PathFlow entry={s.entryPage} exit={s.exitPage} />,
    },
    { key: 'pages', label: t('Pages'), sort: 'pageviews', numeric: true, render: (s) => formatNumber(s.pageviews) },
    {
      key: 'duration',
      label: t('Duration'),
      sort: 'duration',
      numeric: true,
      render: (s) => formatDuration(s.durationMs),
    },
    {
      key: 'revenue',
      label: t('Revenue'),
      sort: 'revenue',
      numeric: true,
      render: (s) => (s.revenue ? formatMoney(s.revenue, site.currency) : '—'),
    },
  ]
  return (
    <View>
      <DataTable
        title={t('Sessions')}
        columns={columns}
        basis={requestKey('sessions', site.id, query.filters)}
        load={({ filters: { visitor, ...filters }, ...request }) =>
          client.sessions(site.id, { ...query, ...request, visitor, filters: { ...query.filters, ...filters } })
        }
        rowKey={(s) => s.id}
        searchLabel={t('Search pages, sources, places, browsers')}
        empty={t('No sessions in this period')}
        filters={[
          {
            key: 'channel',
            label: t('Channel'),
            options: [{ value: '', label: t('All channels') }, ...CHANNELS.map((c) => ({ value: c, label: t(c) }))],
          },
          {
            key: 'device',
            label: t('Device'),
            options: [{ value: '', label: t('All devices') }, ...DEVICES.map((d) => ({ value: d, label: t(d) }))],
          },
          {
            key: 'browser',
            label: t('Browser'),
            options: [
              { value: '', label: t('All browsers') },
              ...(browsers.data ?? []).map((b) => ({ value: b.key, label: b.key })),
            ],
          },
          { key: 'visitor', label: t('Visitor'), format: shortId },
        ]}
        onOpen={(s) => setSelected(s.id)}
        openLabel={(s) =>
          t('Open the visit of {visitor} at {time}', {
            visitor: s.visitorId.slice(-6),
            time: formatDateTime(s.startedAt, site.timezone),
          })
        }
      />
      <SessionDialog sessionId={selected} onClose={() => setSelected(null)} />
    </View>
  )
}
