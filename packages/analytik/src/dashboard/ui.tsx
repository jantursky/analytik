import { motion } from 'motion/react'
import { type ReactNode, useId, useState } from 'react'

import type { Delta, Site } from '../shared/types'
import { Sparkline } from './charts'
import { formatChange } from './format'
import { AnimatedNumber, rise } from './ui/motion'

export function Card({
  title,
  actions,
  hideTitle,
  children,
}: {
  title: string
  actions?: ReactNode
  /** Keeps the title for assistive technology only, e.g. when tabs already say what the card shows. */
  hideTitle?: boolean
  children: ReactNode
}) {
  const id = useId()
  return (
    <motion.section className="analytik-card" aria-labelledby={id} variants={rise}>
      {hideTitle ? (
        <h2 id={id} className="analytik-sr-only">
          {title}
        </h2>
      ) : (
        <header className="analytik-card-header">
          <h2 id={id}>{title}</h2>
          {actions}
        </header>
      )}
      {children}
    </motion.section>
  )
}

const TILE_HUES = 5

/** A site's initial on a tinted square, standing in for a favicon (fetching one would leak the domain). */
export function SiteTile({ site }: { site: Pick<Site, 'name' | 'domain'> }) {
  const text = site.name || site.domain
  let hash = 0
  for (const char of site.domain) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return (
    <span className="analytik-tile" data-hue={hash % TILE_HUES} aria-hidden="true">
      {text.charAt(0).toUpperCase()}
    </span>
  )
}

/** Period-over-period change. `invert` for metrics where lower is better (bounce rate). */
export function DeltaBadge({ change, invert = false }: { change: number | null; invert?: boolean }) {
  const trend = change == null || change === 0 ? 'flat' : change > 0 !== invert ? 'up' : 'down'
  return (
    <span className="analytik-badge" data-trend={trend}>
      <span className="analytik-sr-only">Change from previous period: </span>
      {formatChange(change)}
    </span>
  )
}

export interface StatTileProps {
  label: string
  delta: Delta
  format: (value: number) => string
  invert?: boolean
  trend?: number[]
  /** CSS colour of a legend square before the label, tying the tile to a chart series. */
  marker?: string
  /** Makes the tile a toggle button, e.g. to pick the chart metric. */
  selected?: boolean
  onSelect?: () => void
}

export function StatTile({ label, delta, format, invert, trend, marker, selected, onSelect }: StatTileProps) {
  const body = (
    <>
      <span className="analytik-stat-label">
        {marker && <span className="analytik-marker" style={{ background: marker }} aria-hidden="true" />}
        {label}
      </span>
      <span className="analytik-stat-value">
        <AnimatedNumber value={delta.value} format={format} />
      </span>
      <DeltaBadge change={delta.change} invert={invert} />
      {trend && <Sparkline values={trend} />}
    </>
  )
  return onSelect ? (
    <button type="button" className="analytik-stat" aria-pressed={selected} onClick={onSelect}>
      {body}
    </button>
  ) : (
    <div className="analytik-stat">{body}</div>
  )
}

/** Shows children once loaded; a busy state before and an alert on error. */
export function Status({ loading, error, children }: { loading: boolean; error?: Error; children?: ReactNode }) {
  if (error) {
    return (
      <p className="analytik-error" role="alert">
        {error.message}
      </p>
    )
  }
  if (loading) {
    return (
      <p className="analytik-loading" role="status">
        Loading…
      </p>
    )
  }
  return children
}

/** A labelled form control: the label wraps the control, so no ids are needed. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="analytik-field">
      <span className="analytik-field-label">{label}</span>
      {children}
      {hint && <span className="analytik-field-hint">{hint}</span>}
    </label>
  )
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [status, setStatus] = useState('')
  const copy = (): void => {
    navigator.clipboard.writeText(text).then(
      () => setStatus('Copied'),
      () => setStatus('Copy failed, select the text instead'),
    )
  }
  return (
    <span className="analytik-copy">
      <button type="button" className="analytik-button" onClick={copy}>
        {label}
      </button>
      <span role="status" className="analytik-copy-status">
        {status}
      </span>
    </span>
  )
}

/** A destructive action that asks for a second click before it runs. */
export function ConfirmButton({
  label,
  confirm,
  onConfirm,
}: {
  label: string
  confirm: string
  onConfirm: () => void
}) {
  const [armed, setArmed] = useState(false)
  return (
    <button
      type="button"
      className="analytik-button"
      data-variant="danger"
      onClick={() => {
        if (armed) onConfirm()
        setArmed(!armed)
      }}
      onBlur={() => setArmed(false)}
    >
      {armed ? confirm : label}
    </button>
  )
}
