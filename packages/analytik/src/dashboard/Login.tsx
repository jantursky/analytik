import { type ReactNode, type SubmitEvent, useState } from 'react'

import type { Site } from '../shared/types'
import type { ApiClient } from './api'
import { Field } from './ui'
import { Combobox } from './ui/combobox'
import { Dialog } from './ui/dialog'
import { Select } from './ui/select'

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export function LoginForm({ client, onLogin }: { client: ApiClient; onLogin: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = (event: SubmitEvent): void => {
    event.preventDefault()
    setBusy(true)
    client
      .login(password)
      .then(onLogin, (e: unknown) => setError(message(e)))
      .finally(() => setBusy(false))
  }

  return (
    <form className="analytik-card analytik-login" onSubmit={submit}>
      <h1>Sign in to analytik</h1>
      <Field label="Admin password">
        <input
          className="analytik-input"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoFocus
        />
      </Field>
      {error && (
        <p className="analytik-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="analytik-button" data-variant="primary" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CHF', 'CAD', 'AUD', 'JPY', 'CZK', 'PLN', 'SEK', 'NOK', 'DKK', 'INR', 'BRL']

const localTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone

const timeZones = (): string[] => {
  const local = localTimeZone()
  let all: string[] = []
  try {
    all = Intl.supportedValuesOf('timeZone')
  } catch {
    // Older engines: offer the local zone only.
  }
  return all.includes(local) ? all : [local, ...all]
}

/** `https://www.Example.com/path` → `www.example.com`. */
export const cleanDomain = (input: string): string =>
  input
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/?#].*$/, '')

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
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const ready = !!cleanDomain(domain) && !!name.trim() && !busy

  const submit = (event: SubmitEvent): void => {
    event.preventDefault()
    setBusy(true)
    client
      .createSite({ name: name.trim(), domain: cleanDomain(domain), timezone, currency })
      .then(onCreated, (e: unknown) => setError(message(e)))
      .finally(() => setBusy(false))
  }

  return (
    <form className="analytik-site-form" onSubmit={submit}>
      {children}
      <Field label="Domain" hint="Subdomains (app.example.com) are tracked under the same site.">
        <input
          className="analytik-input"
          value={domain}
          placeholder="example.com"
          inputMode="url"
          autoComplete="off"
          onChange={(e) => setDomain(e.target.value)}
          required
        />
      </Field>
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
        <Combobox label="Timezone" value={timezone} options={timeZones()} onChange={setTimezone} />
        <Select
          label="Revenue currency"
          value={currency}
          options={CURRENCIES.map((c) => ({ value: c, label: c }))}
          onChange={setCurrency}
        />
      </div>
      {error && (
        <p className="analytik-error" role="alert">
          {error}
        </p>
      )}
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
        <h1>Add a website</h1>
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
