import type { KeyboardEvent } from 'react'

import { JOURNEY_SESSION_CAP } from '../../shared/journeys'
import type { JourneysResult } from '../../shared/types'
import { requestKey, useDashboard } from '../context'
import { useResource } from '../data'
import { formatNumber } from '../format'
import { t } from '../i18n'
import { Card, Status } from '../ui'
import { View } from '../ui/motion'
import { FLOW_WIDTH, type PlacedNode, layoutFlow } from './journey-layout'

const LABEL_LENGTH = 26
const clip = (text: string): string => (text.length > LABEL_LENGTH ? `${text.slice(0, LABEL_LENGTH - 1)}…` : text)

function nodeLabel(node: PlacedNode): string {
  if (node.kind === 'exit') return t('Exit')
  if (node.kind === 'other') return t('Other pages')
  return node.path ?? ''
}

/** A page bar: Tab reaches it, Enter or Space filters the dashboard by that page. */
function Bar({ node, onPick }: { node: PlacedNode; onPick: (node: PlacedNode) => void }) {
  const label = nodeLabel(node)
  const text = `${clip(label)} · ${formatNumber(node.sessions)}`
  const pick = node.kind === 'page'
  const labelX = node.side === 'right' ? node.x + 20 : node.x - 8
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onPick(node)
    }
  }
  return (
    <g
      className="analytik-journey-node"
      data-kind={node.kind}
      {...(pick && {
        role: 'button',
        tabIndex: 0,
        onClick: () => onPick(node),
        onKeyDown,
        'aria-label': `${t('{page}, step {step}: {count} sessions', {
          page: label,
          step: node.step,
          count: formatNumber(node.sessions),
        })}${t(', filter by this')}`,
      })}
    >
      <title>{`${label} · ${formatNumber(node.sessions)}`}</title>
      <rect className="analytik-journey-bar" x={node.x} y={node.y} width={12} height={node.height} rx={2} />
      <text
        className="analytik-journey-label"
        x={labelX}
        y={node.y + Math.min(node.height / 2, 12) + 4}
        textAnchor={node.side === 'right' ? 'start' : 'end'}
      >
        {text}
      </text>
    </g>
  )
}

function Flow({ result }: { result: JourneysResult }) {
  const { addFilter } = useDashboard()
  const layout = layoutFlow(result)
  const height = layout.nodes.reduce((max, node) => Math.max(max, node.y + node.height), 0)
  const names = new Map(layout.nodes.map((node) => [node.id, nodeLabel(node)]))
  // The first bar of a column stands for where sessions began; later ones for pages seen on the way.
  const pick = (node: PlacedNode): void => {
    if (node.path) addFilter(node.step === 1 ? 'entry' : 'page', node.path)
  }
  return (
    <>
      <svg
        className="analytik-journeys"
        viewBox={`0 -22 ${FLOW_WIDTH} ${height + 22}`}
        role="group"
        aria-label={t('Journeys')}
      >
        {layout.steps
          .filter((step) => layout.nodes.some((node) => node.step === step && node.kind !== 'exit'))
          .map((step) => (
            <text
              key={step}
              className="analytik-journey-step"
              x={layout.nodes.find((node) => node.step === step)?.x ?? 0}
              y={-8}
            >
              {t('Step {step}', { step })}
            </text>
          ))}
        <g aria-hidden="true">
          {layout.links.map((link) => (
            <path
              key={`${link.from}>${link.to}`}
              className="analytik-journey-link"
              d={link.path}
              strokeWidth={link.width}
              fill="none"
            />
          ))}
        </g>
        {layout.nodes.map((node) => (
          <Bar key={node.id} node={node} onPick={pick} />
        ))}
      </svg>
      <table className="analytik-sr-only">
        <caption>{t('Journeys')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('From')}</th>
            <th scope="col">{t('To')}</th>
            <th scope="col">{t('Sessions')}</th>
          </tr>
        </thead>
        <tbody>
          {layout.links.map((link) => (
            <tr key={`${link.from}>${link.to}`}>
              <td>{names.get(link.from)}</td>
              <td>{names.get(link.to)}</td>
              <td>{formatNumber(link.sessions)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

/** Where sessions go after they land: the most common next pages and where they end, read from the newest sessions. */
export function Journeys() {
  const { client, site, query } = useDashboard()
  const result = useResource<JourneysResult>(requestKey('journeys', site.id, query), () =>
    client.journeys(site.id, query),
  )
  const data = result.data
  return (
    <View>
      <Card title={t('Journeys')} description={t('Where sessions go after the first page, and where they end.')}>
        <Status loading={result.loading && !data} error={result.error}>
          {data &&
            (data.multiPage > 0 ? (
              <>
                <Flow result={data} />
                {data.capped && <p className="analytik-muted">{t('Showing the last 30 days of the range.')}</p>}
                {data.sessions >= JOURNEY_SESSION_CAP && (
                  <p className="analytik-muted">
                    {t('Based on the {count} newest sessions of the period.', { count: formatNumber(data.sessions) })}
                  </p>
                )}
              </>
            ) : (
              <p className="analytik-empty">
                {t('No session in this period viewed more than one page, so there is no path to show.')}
              </p>
            ))}
        </Status>
      </Card>
    </View>
  )
}
