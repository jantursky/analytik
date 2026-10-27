import { type SubmitEvent, useState } from 'react'

import type { PaymentProvider, PrivacyMode, Site } from '../../shared/types'
import type { ExportFormat } from '../api'
import { useDashboard } from '../context'
import { buildCampaignUrl, buildSnippet, type CampaignParams } from '../snippet'
import { Card, ConfirmButton, CopyButton, Field } from '../ui'
import { Combobox } from '../ui/combobox'
import { DatePicker } from '../ui/date-picker'
import { View } from '../ui/motion'
import { Select } from '../ui/select'
import { Switch } from '../ui/switch'

interface Outcome {
  ok: boolean
  text: string
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Runs a request and keeps a success or error message for it. */
function useOutcome(): [Outcome | undefined, (request: Promise<unknown>, success: string) => void] {
  const [outcome, setOutcome] = useState<Outcome>()
  const run = (request: Promise<unknown>, success: string): void => {
    request.then(
      () => setOutcome({ ok: true, text: success }),
      (error: unknown) => setOutcome({ ok: false, text: message(error) }),
    )
  }
  return [outcome, run]
}

function OutcomeMessage({ outcome }: { outcome: Outcome | undefined }) {
  if (!outcome) return <p role="status" className="analytik-sr-only" />
  return outcome.ok ? (
    <p role="status" className="analytik-success">
      {outcome.text}
    </p>
  ) : (
    <p role="alert" className="analytik-error">
      {outcome.text}
    </p>
  )
}

const MODES: { value: PrivacyMode; label: string; hint: string }[] = [
  {
    value: 'strict',
    label: 'Strict',
    hint: 'No cookies or storage. Visitors are a server-side hash that changes every month.',
  },
  { value: 'enriched', label: 'Enriched', hint: 'Adds a per-tab id after the visitor consents.' },
  {
    value: 'persistent',
    label: 'Persistent',
    hint: 'First-party cookies for returning visitors. Needs consent in the EU.',
  },
]

const timeZones = (): string[] => {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return []
  }
}

export function SiteSettings() {
  const { client, site, onSiteChange } = useDashboard()
  const [draft, setDraft] = useState<Site>(site)
  const [ignoredIps, setIgnoredIps] = useState(site.ignoredIps.join('\n'))
  const [outcome, run] = useOutcome()
  const set = <K extends keyof Site>(key: K, value: Site[K]): void => setDraft({ ...draft, [key]: value })

  const submit = (event: SubmitEvent): void => {
    event.preventDefault()
    const { id: _id, createdAt: _createdAt, ...patch } = draft
    const ips = ignoredIps
      .split(/[\s,]+/)
      .map((ip) => ip.trim())
      .filter(Boolean)
    run(client.updateSite(site.id, { ...patch, ignoredIps: ips }).then(onSiteChange), 'Settings saved')
  }

  return (
    <Card title="Site">
      <form className="analytik-form" onSubmit={submit}>
        <Field label="Name">
          <input className="analytik-input" value={draft.name} onChange={(e) => set('name', e.target.value)} required />
        </Field>
        <Field label="Domain" hint="Events are accepted from this domain and its subdomains only.">
          <input
            className="analytik-input"
            value={draft.domain}
            onChange={(e) => set('domain', e.target.value.trim())}
            placeholder="example.com"
            required
          />
        </Field>
        <div className="analytik-row">
          <Combobox
            label="Timezone"
            value={draft.timezone}
            options={timeZones()}
            onChange={(timezone) => set('timezone', timezone)}
          />
          <Field label="Currency">
            <input
              className="analytik-input"
              value={draft.currency}
              maxLength={3}
              pattern="[A-Za-z]{3}"
              onChange={(e) => set('currency', e.target.value.toUpperCase())}
            />
          </Field>
        </div>
        <fieldset className="analytik-choices">
          <legend className="analytik-field-label">Privacy mode</legend>
          {MODES.map((mode) => (
            <label key={mode.value} className="analytik-choice">
              <input
                type="radio"
                name="privacyMode"
                value={mode.value}
                checked={draft.privacyMode === mode.value}
                onChange={() => set('privacyMode', mode.value)}
              />
              <span>
                <strong>{mode.label}</strong>
                <span className="analytik-field-hint">{mode.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <Field label="Keep data for (days)" hint="Empty keeps everything.">
          <input
            className="analytik-input"
            type="number"
            min={1}
            value={draft.retentionDays ?? ''}
            onChange={(e) => set('retentionDays', e.target.value ? Number(e.target.value) : null)}
          />
        </Field>
        <Field
          label="Ignored IP addresses"
          hint="One per line. Matching requests are dropped before anything is stored."
        >
          <textarea
            className="analytik-input"
            rows={3}
            value={ignoredIps}
            onChange={(e) => setIgnoredIps(e.target.value)}
          />
        </Field>
        <Switch checked={draft.allowLocalhost} onChange={(on) => set('allowLocalhost', on)}>
          Accept events from localhost (for testing; turn off once live)
        </Switch>
        <OutcomeMessage outcome={outcome} />
        <div className="analytik-actions">
          <button type="submit" className="analytik-button" data-variant="primary">
            Save
          </button>
        </div>
      </form>
    </Card>
  )
}

export function SnippetGenerator() {
  const { site, apiUrl } = useDashboard()
  const [mode, setMode] = useState<PrivacyMode>(site.privacyMode)
  const [requireInteraction, setRequireInteraction] = useState(true)
  const [autoOutbound, setAutoOutbound] = useState(true)
  const [keepQuery, setKeepQuery] = useState('')
  const snippet = buildSnippet({
    site: site.id,
    apiUrl,
    mode,
    requireInteraction,
    autoOutbound,
    keepQuery,
    debug: false,
  })

  return (
    <Card title="Tracking snippet">
      <p className="analytik-muted">Paste it into the head of every page.</p>
      <div className="analytik-row">
        <Select label="Mode" value={mode} options={MODES} onChange={setMode} />
        <Field label="Keep query parameters" hint="Comma-separated, besides utm_*, ref and source.">
          <input className="analytik-input" value={keepQuery} onChange={(e) => setKeepQuery(e.target.value)} />
        </Field>
      </div>
      <Switch checked={requireInteraction} onChange={setRequireInteraction}>
        Wait for an interaction or 3 seconds on screen before counting (filters bots)
      </Switch>
      <Switch checked={autoOutbound} onChange={setAutoOutbound}>
        Track clicks on outbound links
      </Switch>
      <pre className="analytik-code" aria-label="Snippet">
        <code>{snippet}</code>
      </pre>
      <CopyButton text={snippet} label="Copy snippet" />
    </Card>
  )
}

export function CampaignLinkBuilder() {
  const [base, setBase] = useState('')
  const [params, setParams] = useState<Required<CampaignParams>>({
    source: '',
    medium: '',
    campaign: '',
    term: '',
    content: '',
  })
  const url = params.source.trim() ? buildCampaignUrl(base, params) : null
  const labels: Record<keyof CampaignParams, string> = {
    source: 'Source (required)',
    medium: 'Medium',
    campaign: 'Campaign',
    term: 'Term',
    content: 'Content',
  }

  return (
    <Card title="Campaign link builder">
      <Field label="Page URL">
        <input
          className="analytik-input"
          type="url"
          value={base}
          placeholder="https://example.com/pricing"
          onChange={(e) => setBase(e.target.value)}
        />
      </Field>
      <div className="analytik-row analytik-row-wrap">
        {(Object.keys(labels) as (keyof CampaignParams)[]).map((key) => (
          <Field key={key} label={labels[key]}>
            <input
              className="analytik-input"
              value={params[key]}
              onChange={(e) => setParams({ ...params, [key]: e.target.value })}
            />
          </Field>
        ))}
      </div>
      {url ? (
        <>
          <pre className="analytik-code" aria-label="Campaign link">
            <code>{url}</code>
          </pre>
          <CopyButton text={url} label="Copy link" />
        </>
      ) : (
        <p className="analytik-muted">Enter a full page URL and a source.</p>
      )}
    </Card>
  )
}

function ApiKey() {
  const { client, site } = useDashboard()
  const [key, setKey] = useState<string>()
  const [outcome, run] = useOutcome()
  return (
    <Card title="API key">
      <p className="analytik-muted">
        For server-side goals and payments (<code>Authorization: Bearer …</code>). Rotating revokes the old key.
      </p>
      {key && (
        <>
          <pre className="analytik-code" aria-label="New API key">
            <code>{key}</code>
          </pre>
          <p className="analytik-muted">Store it now: it is shown only once.</p>
          <CopyButton text={key} label="Copy key" />
        </>
      )}
      <OutcomeMessage outcome={outcome} />
      <ConfirmButton
        label="Rotate key"
        confirm="Confirm rotation"
        onConfirm={() =>
          run(
            client.rotateKey(site.id).then((r) => setKey(r.apiKey)),
            'New key created',
          )
        }
      />
    </Card>
  )
}

const PROVIDERS: { value: PaymentProvider; label: string }[] = [
  { value: 'stripe', label: 'Stripe' },
  { value: 'dodo', label: 'Dodo Payments' },
  { value: 'lemonsqueezy', label: 'Lemon Squeezy' },
]

function Webhook({ provider, label }: { provider: PaymentProvider; label: string }) {
  const { client, site, apiUrl } = useDashboard()
  const [secret, setSecret] = useState('')
  const [outcome, run] = useOutcome()
  const url = `${apiUrl}/webhooks/${provider}/${encodeURIComponent(site.id)}`
  const submit = (event: SubmitEvent): void => {
    event.preventDefault()
    run(
      client.updateSite(site.id, { webhookSecrets: { [provider]: secret } }).then(() => setSecret('')),
      `${label} secret saved`,
    )
  }
  return (
    <form className="analytik-form analytik-webhook" onSubmit={submit}>
      <h3>{label}</h3>
      <Field label="Endpoint URL">
        <input className="analytik-input analytik-mono" value={url} readOnly />
      </Field>
      <Field label="Signing secret">
        <input
          className="analytik-input"
          type="password"
          autoComplete="off"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          required
        />
      </Field>
      <OutcomeMessage outcome={outcome} />
      <div className="analytik-actions">
        <CopyButton text={url} label="Copy URL" />
        <button type="submit" className="analytik-button">
          Save secret
        </button>
      </div>
    </form>
  )
}

function DataControls() {
  const { client, site } = useDashboard()
  const [before, setBefore] = useState('')
  const [outcome, run] = useOutcome()
  const formats: ExportFormat[] = ['json', 'csv']
  return (
    <Card title="Data">
      <div className="analytik-actions">
        {formats.map((format) => (
          <a key={format} className="analytik-button" href={client.exportUrl(site.id, format)} download>
            Export {format.toUpperCase()}
          </a>
        ))}
        <button
          type="button"
          className="analytik-button"
          onClick={() => run(client.rematch(site.id), 'Payment attribution re-run')}
        >
          Re-run payment attribution
        </button>
      </div>
      <div className="analytik-row">
        <DatePicker label="Delete data before" value={before} onChange={setBefore} />
        {before && (
          <ConfirmButton
            label="Delete"
            confirm={`Delete everything before ${before}?`}
            onConfirm={() => run(client.purge(site.id, new Date(`${before}T00:00:00`).getTime()), 'Data deleted')}
          />
        )}
      </div>
      <OutcomeMessage outcome={outcome} />
    </Card>
  )
}

export function Settings() {
  return (
    <View>
      <SiteSettings />
      <SnippetGenerator />
      <CampaignLinkBuilder />
      <ApiKey />
      <Card title="Payment webhooks">
        {PROVIDERS.map((p) => (
          <Webhook key={p.value} provider={p.value} label={p.label} />
        ))}
      </Card>
      <DataControls />
    </View>
  )
}
