import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from 'react'

import { JOURNEY_SESSION_CAP } from '../../shared/journeys'
import type { JourneysResult } from '../../shared/types'
import { requestKey, useDashboard } from '../context'
import { useResource } from '../data'
import { formatNumber } from '../format'
import { t } from '../i18n'
import { Icon } from '../icons'
import { Card, Status } from '../ui'
import { View } from '../ui/motion'
import { FLOW_WIDTH, type PlacedNode, layoutFlow } from './journey-layout'
import { MAX_ZOOM, type Viewport, ZOOM_STEP, fit, panBy, zoomAt, zoomLevel } from './journey-zoom'

/** A press that moves less than this many pixels is a click, not a drag. */
const DRAG_THRESHOLD = 4

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

const keepZoom = (next: Viewport, whole: Viewport): Viewport | null => (zoomLevel(next, whole) <= 1 ? null : next)

function Flow({ result }: { result: JourneysResult }) {
  const { addFilter } = useDashboard()
  const layout = layoutFlow(result)
  const height = layout.nodes.reduce((max, node) => Math.max(max, node.y + node.height), 0)
  const names = new Map(layout.nodes.map((node) => [node.id, nodeLabel(node)]))
  // The first bar of a column stands for where sessions began; later ones for pages seen on the way.
  const pick = (node: PlacedNode): void => {
    if (node.path) addFilter(node.step === 1 ? 'entry' : 'page', node.path)
  }
  const whole: Viewport = { x: 0, y: -22, w: FLOW_WIDTH, h: height + 22 }
  const [zoomed, setZoomed] = useState<Viewport | null>(null)
  const view = zoomed ? fit(zoomed, whole) : whole
  const level = zoomLevel(view, whole)
  const change = (next: Viewport, all = whole): void => setZoomed(keepZoom(next, all))
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null)
  const dragged = useRef(false)

  const zoom = (factor: number, px = view.x + view.w / 2, py = view.y + view.h / 2): void =>
    change(zoomAt(view, whole, factor, px, py))
  // Ctrl or ⌘ with the wheel, which is also how a trackpad pinch arrives, zooms at the pointer. A plain wheel still
  // scrolls the page. Registered by hand: React's wheel listeners are passive and cannot stop the page scrolling.
  const { x, y, w, h } = view
  const { x: wholeX, y: wholeY, w: wholeW, h: wholeH } = whole
  useEffect(() => {
    const element = svg.current
    const current = { x, y, w, h }
    const all = { x: wholeX, y: wholeY, w: wholeW, h: wholeH }
    const listener = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return
      const box = element?.getBoundingClientRect()
      if (!box?.width) return
      event.preventDefault()
      const px = current.x + ((event.clientX - box.left) / box.width) * current.w
      const py = current.y + ((event.clientY - box.top) / box.height) * current.h
      setZoomed(keepZoom(zoomAt(current, all, Math.exp(-event.deltaY * 0.01), px, py), all))
    }
    element?.addEventListener('wheel', listener, { passive: false })
    return () => element?.removeEventListener('wheel', listener)
  }, [x, y, w, h, wholeX, wholeY, wholeW, wholeH])

  const onPointerDown = (event: PointerEvent<SVGSVGElement>): void => {
    if (event.button !== 0 || level <= 1) return
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
  }
  const onPointerMove = (event: PointerEvent<SVGSVGElement>): void => {
    const start = drag.current
    const box = svg.current?.getBoundingClientRect()
    if (start?.id !== event.pointerId || !box?.width) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (!start.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      start.moved = true
      svg.current?.setPointerCapture(event.pointerId)
    }
    const unit = view.w / box.width
    start.x = event.clientX
    start.y = event.clientY
    change(panBy(view, whole, -dx * unit, -dy * unit))
  }
  const onPointerEnd = (event: PointerEvent<SVGSVGElement>): void => {
    if (drag.current?.id !== event.pointerId) return
    // The click that follows a drag must not filter the dashboard by the bar the pointer ended on.
    dragged.current = drag.current.moved
    drag.current = null
    if (svg.current?.hasPointerCapture(event.pointerId)) svg.current.releasePointerCapture(event.pointerId)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return
    const step = view.w / 10
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const move = moves[event.key]
    if (event.key === '+' || event.key === '=') zoom(ZOOM_STEP)
    else if (event.key === '-') zoom(1 / ZOOM_STEP)
    else if (event.key === '0') setZoomed(null)
    else if (move && level > 1) change(panBy(view, whole, move[0], move[1]))
    else return
    event.preventDefault()
  }

  return (
    <>
      <div className="analytik-journey-tools">
        <button
          type="button"
          className="analytik-icon-button"
          aria-label={t('Zoom out')}
          title={t('Zoom out')}
          disabled={level <= 1}
          onClick={() => zoom(1 / ZOOM_STEP)}
        >
          <Icon name="minus" />
        </button>
        <button
          type="button"
          className="analytik-icon-button"
          aria-label={t('Zoom in')}
          title={t('Zoom in')}
          disabled={level >= MAX_ZOOM}
          onClick={() => zoom(ZOOM_STEP)}
        >
          <Icon name="plus" />
        </button>
        <button
          type="button"
          className="analytik-icon-button"
          aria-label={t('Reset zoom')}
          title={t('Reset zoom')}
          disabled={level <= 1}
          onClick={() => setZoomed(null)}
        >
          <Icon name="expand" />
        </button>
        <span className="analytik-muted">{t('Ctrl or ⌘ + scroll to zoom, drag to move')}</span>
      </div>
      {/* The arrow, plus, minus and 0 keys act while the frame has focus. */}
      <div className="analytik-journey-frame" tabIndex={0} onKeyDown={onKeyDown} aria-label={t('Journeys')}>
        <svg
          ref={svg}
          className="analytik-journeys"
          data-zoomed={level > 1 ? '' : undefined}
          viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
          role="group"
          aria-label={t('Journeys')}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onClickCapture={(event) => {
            if (!dragged.current) return
            dragged.current = false
            event.stopPropagation()
          }}
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
      </div>
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
