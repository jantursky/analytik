import { useId, useState, type ReactNode } from 'react'

/**
 * Keeps an element mounted while its exit animation runs. The element gets `data-state="open|closed"`; once the
 * closing animation ends, `onAnimationEnd` unmounts it. Reduced motion shortens animations to 1 ms, so this still fires.
 */
export function usePresence(open: boolean) {
  const [mounted, setMounted] = useState(open)
  if (open && !mounted) setMounted(true)
  return {
    mounted: open || mounted,
    props: {
      'data-state': open ? 'open' : 'closed',
      onAnimationEnd: (event: React.AnimationEvent) => {
        if (!open && event.target === event.currentTarget) setMounted(false)
      },
    },
  }
}

interface FrameProps {
  title: string
  description: string
  file: string
  source: string
  children: ReactNode
}

/** An example with a "view source" panel that shows the example's own file next to it. */
export function ExampleFrame({ title, description, file, source, children }: FrameProps) {
  const [open, setOpen] = useState(false)
  const panel = usePresence(open)
  const headingId = useId()
  const panelId = useId()
  return (
    <section className={panel.mounted ? 'frame frame--split' : 'frame'} aria-labelledby={headingId}>
      <header className="frame__head">
        <div>
          <h2 id={headingId}>{title}</h2>
          <p>{description}</p>
        </div>
        <button
          type="button"
          className="btn"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => {
            setOpen(!open)
          }}
        >
          {open ? 'Hide source' : 'View source'}
        </button>
      </header>
      <div className="frame__body">
        <div className="frame__demo">{children}</div>
        {panel.mounted && (
          <aside className="frame__source" id={panelId} aria-label={`Source of ${file}`} {...panel.props}>
            <div className="frame__file">{file}</div>
            <pre tabIndex={0}>
              <code>{source}</code>
            </pre>
          </aside>
        )}
      </div>
    </section>
  )
}

const CopyIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className="copy__icon">
    <rect x="5" y="5" width="8.5" height="8.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path
      d="M10.5 3.5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v6.5a1 1 0 0 0 1 1h.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  </svg>
)

const CheckIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className="copy__icon copy__icon--done">
    <path
      d="m3 8.5 3 3 7-7"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

/** A copy button that confirms with a check mark. The confirmation is announced to screen readers too. */
export function CopyButton({ text, label, primary = false }: { text: string; label: string; primary?: boolean }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true)
        window.setTimeout(() => {
          setCopied(false)
        }, 1600)
      },
      () => {
        setCopied(false)
      },
    )
  }
  return (
    <button
      type="button"
      className={primary ? 'btn btn--primary copy' : 'btn btn--ghost copy'}
      data-copied={copied}
      onClick={copy}
      aria-label={label}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
    </button>
  )
}

/** A code block with a copy button. Long lines wrap inside the box, so it never widens the page. */
export function CodeBlock({ label, code }: { label: string; code: string }) {
  return (
    <div className="code">
      <div className="code__bar">
        <span>{label}</span>
        <CopyButton text={code} label={`Copy ${label}`} />
      </div>
      <pre tabIndex={0}>
        <code>{code}</code>
      </pre>
    </div>
  )
}

/** A disclosure whose content stays mounted (form state survives) and slides open and closed. */
export function Collapsible({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const regionId = useId()
  return (
    <section className="collapsible" data-open={open}>
      <h3 className="collapsible__heading">
        <button
          type="button"
          className="collapsible__toggle"
          aria-expanded={open}
          aria-controls={regionId}
          onClick={() => {
            setOpen(!open)
          }}
        >
          <span>
            <span className="collapsible__title">{title}</span>
            <span className="collapsible__hint">{hint}</span>
          </span>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" className="collapsible__chevron">
            <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
        </button>
      </h3>
      <div className="collapsible__region" id={regionId} inert={!open}>
        <div className="collapsible__inner">{children}</div>
      </div>
    </section>
  )
}
