import { motion } from 'motion/react'
import { type ReactNode, type SubmitEvent, useId, useState } from 'react'

import type { Site } from '../shared/types'
import { cleanDomain, domainProblem } from '../shared/url'
import type { ApiClient } from './api'
import { BrandMark } from './brand'
import { Icon } from './icons'
import { ThemeToggle } from './theme-toggle'
import { ErrorNote, Field } from './ui'
import { CurrencySelect } from './ui/currency'
import { Dialog } from './ui/dialog'
import { localTimeZone, TimeZoneSelect } from './ui/timezone'

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The mark and name above a form on its own card, with the theme switch on the right. */
function CardHead() {
  return (
    <div className="analytik-login-head">
      <span className="analytik-login-brand">
        <BrandMark />
        Analytik
      </span>
      <ThemeToggle />
    </div>
  )
}

export function LoginForm({ client, onLogin }: { client: ApiClient; onLogin: () => void }) {
  const [password, setPassword] = useState('')
  const [shown, setShown] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = (event: SubmitEvent): void => {
    event.preventDefault()
    setBusy(true)
    setError('')
    client
      .login(password)
      .then(onLogin, (e: unknown) => setError(message(e)))
      .finally(() => setBusy(false))
  }

  return (
    <form className="analytik-card analytik-login" onSubmit={submit}>
      <CardHead />
      <div>
        <h1>Sign in to Analytik</h1>
        <p className="analytik-login-lede">Enter the admin password to open your dashboard.</p>
      </div>
      <Field label="Admin password">
        <span className="analytik-password">
          <input
            className="analytik-input"
            type={shown ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            aria-invalid={error ? true : undefined}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
          />
          <button
            type="button"
            className="analytik-pill-icon analytik-password-toggle"
            aria-label={shown ? 'Hide password' : 'Show password'}
            aria-pressed={shown}
            onClick={() => setShown(!shown)}
          >
            <Icon name={shown ? 'eye-off' : 'eye'} />
          </button>
        </span>
      </Field>
      {error && <ErrorNote title="Couldn't sign in">{error}</ErrorNote>}
      <button type="submit" className="analytik-button analytik-wide" data-variant="primary" disabled={busy}>
        {busy ? 'Checking…' : 'Sign in'}
      </button>
    </form>
  )
}

/** The domain input of a site form: says what is wrong once the field is left, and what will be tracked. */
export function DomainField({
  value,
  onChange,
  hint,
  touched,
  onBlur,
}: {
  value: string
  onChange: (value: string) => void
  hint: string
  /** Show the problem; true once the field was left or the form submitted. */
  touched: boolean
  onBlur: () => void
}) {
  const errorId = useId()
  const problem = touched ? domainProblem(value) : null
  const clean = cleanDomain(value)
  const differs = clean && clean !== value.trim().toLowerCase()
  return (
    <Field
      label="Domain"
      hint={
        differs ? (
          <>
            Tracked as <strong>{clean}</strong>. {hint}
          </>
        ) : (
          hint
        )
      }
      error={problem ? { id: errorId, text: problem } : null}
    >
      <span className="analytik-input-group">
        <span className="analytik-input-lead" aria-hidden="true">
          <Icon name="globe" />
          https://
        </span>
        <input
          className="analytik-input"
          value={value}
          placeholder="example.com"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? errorId : undefined}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          required
        />
      </span>
    </Field>
  )
}

/** A name for a site from its domain: `www.example.com` is "Example", `docs.example.com` is "Docs". */
const nameFromDomain = (domain: string): string => {
  const label = domain.split('.').find((part) => part !== 'www') ?? ''
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function SiteForm({
  client,
  sites = [],
  onCreated,
  children,
}: {
  client: ApiClient
  /** The sites that exist; the newest one gives the timezone, currency and retention a new site starts with. */
  sites?: Site[]
  onCreated: (site: Site) => void
  /** The heading above the fields, if any. */
  children?: ReactNode
}) {
  const last = sites.reduce<Site | undefined>(
    (newest, s) => (!newest || s.createdAt > newest.createdAt ? s : newest),
    undefined,
  )
  const [domain, setDomain] = useState('')
  const [name, setName] = useState('')
  const [timezone, setTimezone] = useState(last?.timezone ?? localTimeZone())
  const [currency, setCurrency] = useState(last?.currency ?? 'USD')
  const [retention, setRetention] = useState(last?.retentionDays ? String(last.retentionDays) : '')
  const [touched, setTouched] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const clean = domainProblem(domain) ? null : cleanDomain(domain)
  const days = retention.trim() ? Number(retention) : null
  const retentionProblem =
    days !== null && (!Number.isInteger(days) || days < 1 || days > 36500)
      ? 'Use a whole number of days from 1 to 36500, or leave it empty.'
      : null
  const retentionId = useId()
  const optionsId = useId()
  const [optionsOpen, setOptionsOpen] = useState(false)
  const suggested = clean ? nameFromDomain(clean) : ''
  const ready = !!domain.trim() && !busy && !retentionProblem

  const submit = (event: SubmitEvent): void => {
    event.preventDefault()
    setTouched(true)
    if (!clean) return
    setBusy(true)
    client
      .createSite({ name: name.trim() || suggested || clean, domain: clean, timezone, currency, retentionDays: days })
      .then(onCreated, (e: unknown) => setError(message(e)))
      .finally(() => setBusy(false))
  }

  return (
    <form className="analytik-site-form" onSubmit={submit}>
      {children}
      <DomainField
        value={domain}
        onChange={setDomain}
        hint="Subdomains (app.example.com) are tracked under the same site."
        touched={touched}
        onBlur={() => setTouched(!!domain.trim())}
      />
      <Field label="Name" hint="Optional. Shown in the site list; the domain gives a name if you leave it empty.">
        <input
          className="analytik-input"
          value={name}
          placeholder={suggested || 'My website'}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <div className="analytik-site-options" data-open={optionsOpen ? '' : undefined}>
        <button
          type="button"
          className="analytik-site-options-toggle"
          aria-expanded={optionsOpen}
          aria-controls={optionsId}
          onClick={() => setOptionsOpen(!optionsOpen)}
        >
          <span className="analytik-site-options-title">
            <Icon name="sliders" />
            Options
          </span>
          <span className="analytik-site-options-summary">
            {timezone} · {currency} · {days ? `keeps ${days} days` : 'keeps all data'}
          </span>
          <Icon name="down" />
        </button>
        <motion.div
          id={optionsId}
          className="analytik-site-options-panel"
          initial={false}
          animate={{ height: optionsOpen ? 'auto' : 0, opacity: optionsOpen ? 1 : 0 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          inert={!optionsOpen}
        >
          <div className="analytik-site-options-body">
            <div className="analytik-row">
              <TimeZoneSelect label="Timezone" value={timezone} onChange={setTimezone} />
              <CurrencySelect label="Revenue currency" value={currency} onChange={setCurrency} />
            </div>
            <Field
              label="Keep data for (days)"
              hint="Optional. Older visits and events are deleted, payments stay. Empty keeps everything."
              error={retentionProblem ? { id: retentionId, text: retentionProblem } : null}
            >
              <input
                className="analytik-input"
                type="number"
                inputMode="numeric"
                min={1}
                max={36500}
                step={1}
                value={retention}
                placeholder="Keep everything"
                aria-invalid={retentionProblem ? true : undefined}
                aria-describedby={retentionProblem ? retentionId : undefined}
                onChange={(e) => setRetention(e.target.value)}
              />
            </Field>
            <p className="analytik-field-hint">
              {last
                ? `Timezone, currency and retention start as on ${last.name}. You can change them later in the site's settings.`
                : "You can change these later in the site's settings."}
            </p>
          </div>
        </motion.div>
      </div>
      {error && <ErrorNote title="Couldn't add the website">{error}</ErrorNote>}
      <button type="submit" className="analytik-button analytik-wide" data-variant="primary" disabled={!ready}>
        <Icon name="plus" />
        {busy ? 'Adding…' : 'Add website'}
      </button>
    </form>
  )
}

/** The form for a first site, on its own card. */
export function CreateSiteForm({ client, onCreated }: { client: ApiClient; onCreated: (site: Site) => void }) {
  return (
    <div className="analytik-card analytik-login">
      <SiteForm client={client} onCreated={onCreated}>
        <CardHead />
        <div>
          <h1>Add your first website</h1>
          <p className="analytik-login-lede">Enter its domain to get the tracking code.</p>
        </div>
      </SiteForm>
    </div>
  )
}

export interface AddSiteDialogProps {
  client: ApiClient
  onCreated: (site: Site) => void
  /** Called on Escape, the close button or a click on the backdrop. */
  onClose: () => void
  /** Default `true`: render it to open it. Pass `open` instead to keep it mounted, so closing animates. */
  open?: boolean
  /** The sites that exist, so a new one starts with the timezone, currency and retention of the newest. */
  sites?: Site[]
}

/** "Add a website" as a modal dialog (a bottom sheet on phones). */
export function AddSiteDialog({ client, onCreated, onClose, open = true, sites }: AddSiteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()} title="Add a website">
      <SiteForm client={client} sites={sites} onCreated={onCreated}>
        <p className="analytik-login-lede">Enter its domain to get the tracking code.</p>
      </SiteForm>
    </Dialog>
  )
}
