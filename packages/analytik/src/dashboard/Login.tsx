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
    </Field>
  )
}

function SiteForm({
  client,
  onCreated,
  children,
}: {
  client: ApiClient
  onCreated: (site: Site) => void
  /** The heading above the fields, if any. */
  children?: ReactNode
}) {
  const [domain, setDomain] = useState('')
  const [name, setName] = useState('')
  const [timezone, setTimezone] = useState(localTimeZone)
  const [currency, setCurrency] = useState('USD')
  const [retention, setRetention] = useState('')
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
  const ready = !!name.trim() && !busy && !retentionProblem

  const submit = (event: SubmitEvent): void => {
    event.preventDefault()
    setTouched(true)
    if (!clean) return
    setBusy(true)
    client
      .createSite({ name: name.trim(), domain: clean, timezone, currency, retentionDays: days })
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
      <Field label="Name">
        <input
          className="analytik-input"
          value={name}
          placeholder="My website"
          onChange={(e) => setName(e.target.value)}
          required
        />
      </Field>
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
      {error && <ErrorNote title="Couldn't add the website">{error}</ErrorNote>}
      <button type="submit" className="analytik-button analytik-wide" data-variant="primary" disabled={!ready}>
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
}

/** "Add a website" as a modal dialog (a bottom sheet on phones). */
export function AddSiteDialog({ client, onCreated, onClose, open = true }: AddSiteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()} title="Add a website">
      <SiteForm client={client} onCreated={onCreated} />
    </Dialog>
  )
}
