import { AnimatePresence, motion } from 'motion/react'
import { type MouseEvent, type ReactNode, useEffect, useState } from 'react'

import { countryName, flagEmoji } from '../format'
import { Icon, type IconName } from '../icons'
import { hasLogo, Logo } from '../logo'
import { useTableFilter } from './DataTable'

const COPIED_MS = 1600

/** Keeps a click on a cell's own button from also opening the row. */
const own =
  (action: () => void) =>
  (event: MouseEvent): void => {
    event.stopPropagation()
    action()
  }

/** A small icon button that copies `text`; shows a green check for a moment once copied. Revealed on row hover. */
export function CopyId({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copied])
  const icon: IconName = copied ? 'check' : 'copy'
  return (
    <button
      type="button"
      className="analytik-cell-action"
      data-done={copied ? '' : undefined}
      aria-label={copied ? 'Copied' : label}
      title={label}
      onClick={own(() => void navigator.clipboard.writeText(text).then(() => setCopied(true)))}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={icon}
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.5 }}
          transition={{ type: 'spring', stiffness: 500, damping: 26 }}
        >
          <Icon name={icon} />
        </motion.span>
      </AnimatePresence>
    </button>
  )
}

/** Narrows the surrounding table to this value; nothing outside a table. */
function FilterBy({ name, value, label }: { name: string; value: string; label: string }) {
  const filter = useTableFilter()
  if (!filter) return null
  return (
    <button
      type="button"
      className="analytik-cell-action"
      aria-label={label}
      title={label}
      onClick={own(() => filter(name, value))}
    >
      <Icon name="filter" />
    </button>
  )
}

const AVATAR_HUES = 8

export interface VisitorProps {
  /** Picks the colours; the same id always gets the same ones. */
  id: string
  /** Shown instead of the end of the id. */
  label?: ReactNode
  /** Adds a copy button for this text, e.g. the full visitor or customer id. */
  copy?: { text: string; label: string }
  /** Adds a button that narrows the table to this visitor id. */
  filter?: string
}

/** A visitor as a two-tone disc and the end of their id, with optional copy and filter buttons shown on hover. */
export function Visitor({ id, label, copy, filter }: VisitorProps) {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return (
    <span className="analytik-who">
      <span className="analytik-avatar" data-hue={hash % AVATAR_HUES} data-tone={(hash >> 3) % 3} aria-hidden="true" />
      <span className="analytik-who-text">{label ?? <span className="analytik-mono">{id.slice(-6)}</span>}</span>
      {(copy ?? filter) && (
        <span className="analytik-cell-actions">
          {copy && <CopyId text={copy.text} label={copy.label} />}
          {filter && <FilterBy name="visitor" value={filter} label="Show only this visitor" />}
        </span>
      )}
    </span>
  )
}

/** The visitor id cell of a list: copy the full id, or narrow the list to this visitor. */
export const VisitorCell = ({ id }: { id: string }) => (
  <Visitor id={id} copy={{ text: id, label: 'Copy visitor id' }} filter={id} />
)

/** The country's flag and name, with the city when known. */
export function Place({ country, city }: { country: string | null; city?: string | null }) {
  if (!country) return <span className="analytik-muted">Unknown</span>
  return (
    <span className="analytik-place">
      <span aria-hidden="true">{flagEmoji(country)}</span>
      <span>
        {countryName(country)}
        {city && <span className="analytik-sub">{city}</span>}
      </span>
    </span>
  )
}

const DEVICE_ICONS: Record<string, IconName> = { Desktop: 'desktop', Mobile: 'mobile', Tablet: 'tablet' }

/** "Desktop · Chrome" with the browser's mark, for places with no room for two columns. */
export function Device({ device, browser }: { device: string | null; browser: string | null }) {
  return (
    <span className="analytik-tech">
      {browser && hasLogo(browser) ? <Logo name={browser} /> : <span className="analytik-logo" aria-hidden="true" />}
      <span>
        {device ?? 'Unknown'}
        {browser && <span className="analytik-muted"> · {browser}</span>}
      </span>
    </span>
  )
}

/** The device type with its icon. */
export function DeviceType({ device }: { device: string | null }) {
  const icon = device ? DEVICE_ICONS[device] : undefined
  return (
    <span className="analytik-tech">
      {icon ? <Icon name={icon} /> : <span className="analytik-logo" aria-hidden="true" />}
      <span>{device ?? 'Unknown'}</span>
    </span>
  )
}

/** The browser with its mark, and the operating system under it. */
export function Browser({ browser, os }: { browser: string | null; os?: string | null }) {
  return (
    <span className="analytik-tech">
      {browser && hasLogo(browser) ? <Logo name={browser} /> : <span className="analytik-logo" aria-hidden="true" />}
      <span>
        {browser ?? 'Unknown'}
        {os && <span className="analytik-sub">{os}</span>}
      </span>
    </span>
  )
}

/** Where a visit started and ended; one page when it did not move. */
export function PathFlow({ entry, exit }: { entry: string | null; exit: string | null }) {
  if (!entry) return <span className="analytik-muted">—</span>
  return (
    <span className="analytik-flow analytik-mono" title={exit && exit !== entry ? `${entry} → ${exit}` : entry}>
      <span>{entry}</span>
      {exit && exit !== entry && (
        <>
          <Icon name="arrow" />
          <span className="analytik-sr-only">to</span>
          <span>{exit}</span>
        </>
      )}
    </span>
  )
}
