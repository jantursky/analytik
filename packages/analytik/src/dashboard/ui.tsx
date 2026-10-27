import { AnimatePresence, motion } from 'motion/react'
import { createContext, type ReactNode, use, useEffect, useId, useState } from 'react'

import { isTestDomain } from '../shared/test-sites'
import type { Delta, Site } from '../shared/types'
import { BrandMark } from './brand'
import { Sparkline } from './charts'
import { formatChange } from './format'
import { Icon, type IconName } from './icons'
import { Dialog } from './ui/dialog'
import { AnimatedNumber, EASE, rise } from './ui/motion'
import { Tooltip } from './ui/tooltip'

export function Card({
  title,
  description,
  actions,
  hideTitle,
  children,
}: {
  title: string
  /** A sentence under the title saying what the card is for. */
  description?: ReactNode
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
          <div>
            <h2 id={id}>{title}</h2>
            {description && <p className="analytik-card-description">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </motion.section>
  )
}

const TILE_HUES = 5

/** Where a site's icon comes from: `true` for its `/favicon.ico`, `false` for none, or a function returning a URL. */
export type FaviconSource = boolean | ((site: Pick<Site, 'name' | 'domain'>) => string | undefined)

export const FaviconsContext = createContext<FaviconSource>(true)

const FAVICON_FAILURES = 'analytik:favicon-failures'
const RETRY_AFTER_MS = 7 * 86_400_000

/** Icon URLs that failed to load, with the time they failed, so a missing icon is not requested on every view. */
function failures(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(FAVICON_FAILURES) ?? '{}') as Record<string, number>
  } catch {
    return {}
  }
}

function rememberFailure(src: string): void {
  try {
    localStorage.setItem(FAVICON_FAILURES, JSON.stringify({ ...failures(), [src]: Date.now() }))
  } catch {
    // Storage may be unavailable (private mode); the icon is then simply requested again next time.
  }
}

/** A public host name, not localhost or an IP address, whose favicon is worth asking for. */
const iconHost = (domain: string): string | undefined =>
  /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(domain) ? domain.toLowerCase() : undefined

function Favicon({ src }: { src: string }) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>(() => {
    const failedAt = failures()[src]
    return failedAt && Date.now() - failedAt < RETRY_AFTER_MS ? 'failed' : 'loading'
  })
  if (state === 'failed') return null
  const fail = (): void => {
    rememberFailure(src)
    setState('failed')
  }
  return (
    // The browser's HTTP cache keeps the icon.
    <img
      className="analytik-favicon"
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      decoding="async"
      data-loaded={state === 'loaded' ? '' : undefined}
      onLoad={(event) => (event.currentTarget.naturalWidth > 1 ? setState('loaded') : fail())}
      onError={fail}
    />
  )
}

// Body and face colours for the mark of a generated test site: a strong colour with a light or dark partner, each
// pair readable on the tile in both themes.
const TEST_MARKS: readonly (readonly [string, string])[] = [
  ['#7c5cff', '#ffd166'],
  ['#0e9f6e', '#fde68a'],
  ['#ef476f', '#ffd6a5'],
  ['#0ea5e9', '#fbcfe8'],
  ['#f97316', '#fef3c7'],
  ['#14b8a6', '#fb7185'],
  ['#4f46e5', '#a7f3d0'],
  ['#e11d48', '#fde047'],
]

/**
 * A site's favicon over its initial on a tinted square; the initial stays when the site has no icon. Sites made by
 * the test data generator have no real domain to ask; they get the analytik mark in a colour pair of their own.
 */
export function SiteTile({ site }: { site: Pick<Site, 'name' | 'domain'> }) {
  const favicons = use(FaviconsContext)
  const text = site.name || site.domain
  let hash = 0
  for (const char of site.domain) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  if (isTestDomain(site.domain)) {
    const [body, face] = TEST_MARKS[hash % TEST_MARKS.length] ?? ['', '']
    return (
      <span className="analytik-tile analytik-tile-mark" aria-hidden="true">
        <BrandMark body={body} face={face} />
      </span>
    )
  }
  let src
  if (typeof favicons === 'function') src = favicons(site)
  else if (favicons) {
    // By default the request goes to the site itself, never to a third-party icon service.
    const host = iconHost(site.domain)
    src = host && `https://${host}/favicon.ico`
  }
  return (
    <span className="analytik-tile" data-hue={hash % TILE_HUES} aria-hidden="true">
      {text.charAt(0).toUpperCase()}
      {src && <Favicon key={src} src={src} />}
    </span>
  )
}

/** Period-over-period change. `invert` for metrics where lower is better (bounce rate). */
export function DeltaBadge({ change, invert = false }: { change: number | null; invert?: boolean }) {
  const trend = change == null || change === 0 ? 'flat' : change > 0 !== invert ? 'up' : 'down'
  return (
    <span className="analytik-delta" data-trend={trend}>
      {trend !== 'flat' && <Icon name={(change ?? 0) > 0 ? 'up' : 'down'} />}
      <span className="analytik-sr-only">Change from previous period: </span>
      {formatChange(change)}
    </span>
  )
}

/**
 * A number shortened to fit (101.1K): a small info mark says so, and hovering or focusing it shows the exact value.
 * `children` is what is on screen; when `exact` reads the same, nothing is added.
 */
export function Shortened({ shown, exact, children }: { shown: string; exact: string; children: ReactNode }) {
  if (shown === exact) return children
  return (
    <Tooltip label={exact}>
      <span className="analytik-shortened">
        {children}
        <Icon name="info" />
        <span className="analytik-sr-only">(exactly {exact})</span>
      </span>
    </Tooltip>
  )
}

export interface StatTileProps {
  label: string
  delta: Delta
  format: (value: number) => string
  /** The full value when `format` shortens it; shown in a tooltip. */
  exact?: (value: number) => string
  invert?: boolean
  trend?: number[]
  /** CSS colour of a legend square before the label, tying the tile to a chart series. */
  marker?: string
  /** Makes the tile a toggle button, e.g. to pick the chart metric. */
  selected?: boolean
  onSelect?: () => void
}

export function StatTile({ label, delta, format, exact, invert, trend, marker, selected, onSelect }: StatTileProps) {
  const body = (
    <>
      <span className="analytik-stat-label">
        {marker && <span className="analytik-marker" style={{ background: marker }} aria-hidden="true" />}
        {label}
      </span>
      <span className="analytik-stat-value">
        <Shortened shown={format(delta.value)} exact={(exact ?? format)(delta.value)}>
          <AnimatedNumber value={delta.value} format={format} />
        </Shortened>
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
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: ReactNode
  /** Replaces the hint while the value is wrong; the input should point at it with `aria-describedby`. */
  error?: { id: string; text: string } | null
  children: ReactNode
}) {
  return (
    <label className="analytik-field">
      <span className="analytik-field-label">{label}</span>
      {children}
      {error ? (
        <span className="analytik-field-error" id={error.id}>
          {error.text}
        </span>
      ) : (
        hint && <span className="analytik-field-hint">{hint}</span>
      )}
    </label>
  )
}

export interface Outcome {
  ok: boolean
  text: string
}

const SHOW_SUCCESS_MS = 2600

/**
 * The result of an action: a green line with a check that fades out after a moment, or an error that stays. Both
 * live regions are always rendered, so screen readers announce what appears in them.
 */
export function Notice({ outcome }: { outcome: Outcome | undefined }) {
  const [dismissed, setDismissed] = useState<Outcome>()
  useEffect(() => {
    if (!outcome?.ok) return
    const timer = setTimeout(() => setDismissed(outcome), SHOW_SUCCESS_MS)
    return () => clearTimeout(timer)
  }, [outcome])
  const shown = outcome === dismissed ? undefined : outcome
  const flash = (ok: boolean) => (
    <AnimatePresence>
      {shown?.ok === ok && (
        <motion.span
          className="analytik-notice"
          data-ok={ok ? '' : undefined}
          initial={{ opacity: 0, x: 6, scale: 0.96 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
          transition={{ duration: 0.25, ease: EASE }}
        >
          {ok && <Icon name="check" />}
          {shown.text}
        </motion.span>
      )}
    </AnimatePresence>
  )
  return (
    <span className="analytik-notices">
      <span role="status">{flash(true)}</span>
      <span role="alert">{flash(false)}</span>
    </span>
  )
}

/** Runs a request and keeps a success or error message for it; the message can be made from the response. */
export function useOutcome(): [
  Outcome | undefined,
  <T>(request: Promise<T>, success: string | ((value: T) => string)) => void,
] {
  const [outcome, setOutcome] = useState<Outcome>()
  const run = <T,>(request: Promise<T>, success: string | ((value: T) => string)): void => {
    // A message from the previous run would read as this one's result while it is still going.
    setOutcome(undefined)
    request.then(
      (value) => setOutcome({ ok: true, text: typeof success === 'string' ? success : success(value) }),
      (error: unknown) => setOutcome({ ok: false, text: error instanceof Error ? error.message : String(error) }),
    )
  }
  return [outcome, run]
}

/** A right-aligned row of buttons at the end of a card or form, with the result of the last action before them. */
export function Actions({ outcome, children }: { outcome?: Outcome; children: ReactNode }) {
  return (
    <div className="analytik-actions analytik-card-actions">
      <Notice outcome={outcome} />
      {children}
    </div>
  )
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [outcome, setOutcome] = useState<Outcome>()
  const copy = (): void => {
    navigator.clipboard.writeText(text).then(
      () => setOutcome({ ok: true, text: 'Copied' }),
      () => setOutcome({ ok: false, text: 'Copy failed, select the text instead' }),
    )
  }
  return (
    <span className="analytik-copy">
      <Notice outcome={outcome} />
      <button type="button" className="analytik-button" onClick={copy}>
        {label}
      </button>
    </span>
  )
}

export interface ConfirmButtonProps {
  /** The button that opens the dialog. */
  label: string
  /** The dialog title, a question. */
  title: string
  /** What happens, and whether it can be undone. */
  description: ReactNode
  /** The button in the dialog that runs the action. Default: `label`. */
  confirmLabel?: string
  onConfirm: () => void
  disabled?: boolean
  /** `plain` for an action that only resets settings: a quiet button and a primary confirm. Default `danger`. */
  tone?: 'danger' | 'plain'
  /** An icon before the label. */
  icon?: IconName
}

/** A destructive action that asks in a dialog before it runs. */
export function ConfirmButton({
  label,
  title,
  description,
  confirmLabel = label,
  onConfirm,
  disabled,
  tone = 'danger',
  icon,
}: ConfirmButtonProps) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className="analytik-button"
        data-variant={tone === 'danger' ? 'danger' : undefined}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {icon && <Icon name={icon} />}
        {label}
      </button>
      <Dialog open={open} onOpenChange={setOpen} title={title}>
        <p className="analytik-dialog-text">{description}</p>
        <div className="analytik-actions analytik-card-actions">
          <button type="button" className="analytik-button" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="analytik-button"
            data-variant={tone === 'danger' ? 'danger-solid' : 'primary'}
            onClick={() => {
              setOpen(false)
              onConfirm()
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </Dialog>
    </>
  )
}
