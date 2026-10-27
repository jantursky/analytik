import { useState } from 'react'

import type { SessionSummary } from '../../shared/types'
import type { SessionDetail } from '../api'
import { requestKey, useDashboard } from '../context'
import { usePaged, useResource } from '../data'
import { formatDateTime, formatDuration, formatMoney } from '../format'
import { Card, Status } from '../ui'
import { View } from '../ui/motion'
import { LoadMore } from './LoadMore'

const place = (s: SessionSummary): string => [s.city, s.country].filter(Boolean).join(', ') || '—'

/** Every event of one session, in order, with the time since the session started. */
export function SessionTimeline({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const { client, site } = useDashboard()
  const detail = useResource<SessionDetail>(requestKey('session', site.id, sessionId), () =>
    client.session(site.id, sessionId),
  )
  const session = detail.data?.session
  return (
    <Card
      title="Visitor timeline"
      actions={
        <button type="button" className="analytik-button" onClick={onClose}>
          Close
        </button>
      }
    >
      <Status loading={detail.loading} error={detail.error}>
        {session && (
          <>
            <p className="analytik-muted">
              {formatDateTime(session.startedAt, site.timezone)} · {session.source} · {place(session)} ·{' '}
              {[session.device, session.browser, session.os].filter(Boolean).join(' / ')}
            </p>
            <ol className="analytik-timeline">
              {detail.data?.events.map((e) => (
                <li key={e.id} data-type={e.type}>
                  <span className="analytik-mono">+{formatDuration(e.ts - session.startedAt)}</span>
                  <span className="analytik-badge">{e.type}</span>
                  <span>{e.name ?? e.path ?? '—'}</span>
                </li>
              ))}
            </ol>
          </>
        )}
      </Status>
    </Card>
  )
}

export function Sessions() {
  const { client, site, query } = useDashboard()
  const [selected, setSelected] = useState<string | null>(null)
  const sessions = usePaged<SessionSummary>(requestKey('sessions', site.id, query), (cursor) =>
    client.sessions(site.id, { ...query, cursor }),
  )
  return (
    <View>
      {selected && <SessionTimeline sessionId={selected} onClose={() => setSelected(null)} />}
      <Card title="Sessions">
        <Status loading={sessions.loading} error={sessions.error}>
          {sessions.items.length ? (
            <div className="analytik-table-wrap">
              <table className="analytik-table">
                <thead>
                  <tr>
                    <th scope="col">Started</th>
                    <th scope="col">Source</th>
                    <th scope="col">Location</th>
                    <th scope="col">Entry page</th>
                    <th scope="col" className="analytik-num">
                      Pages
                    </th>
                    <th scope="col" className="analytik-num">
                      Duration
                    </th>
                    <th scope="col" className="analytik-num">
                      Revenue
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.items.map((s) => (
                    <tr key={s.id} aria-selected={s.id === selected}>
                      <td>
                        <button type="button" className="analytik-link" onClick={() => setSelected(s.id)}>
                          {formatDateTime(s.startedAt, site.timezone)}
                        </button>
                      </td>
                      <td>{s.source || s.channel}</td>
                      <td>{place(s)}</td>
                      <td className="analytik-mono">{s.entryPage ?? '—'}</td>
                      <td className="analytik-num">{s.pageviews}</td>
                      <td className="analytik-num">{formatDuration(s.durationMs)}</td>
                      <td className="analytik-num">{s.revenue ? formatMoney(s.revenue, site.currency) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="analytik-empty">No sessions in this period</p>
          )}
          <LoadMore list={sessions} />
        </Status>
      </Card>
    </View>
  )
}
