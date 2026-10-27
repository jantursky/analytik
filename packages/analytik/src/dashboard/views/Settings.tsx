import { AnimatePresence, motion } from 'motion/react'
import { type ComponentType, type SubmitEvent, useState } from 'react'

import type { PaymentProvider, PrivacyMode, Site } from '../../shared/types'
import { cleanDomain, domainProblem } from '../../shared/url'
import type { ExportFormat } from '../api'
import { useDashboard } from '../context'
import { useResource } from '../data'
import { DomainField } from '../Login'
import { Logo } from '../logo'
import { buildCampaignUrl, buildSnippet, type CampaignParams } from '../snippet'
import { Actions, Card, ConfirmButton, CopyButton, Field, useOutcome } from '../ui'
import { CurrencySelect } from '../ui/currency'
import { DatePicker } from '../ui/date-picker'
import { stagger, View } from '../ui/motion'
import { Select } from '../ui/select'
import { Switch } from '../ui/switch'
import { TimeZoneSelect } from '../ui/timezone'
import { Icon, type IconName } from '../icons'
import { DebugSettings } from './DebugSettings'
import { FormatSettings, ThemeSettings } from './FormatSettings'
import { SiteLifecycle } from './SiteActions'

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

type SiteDraft = Omit<Site, 'id' | 'createdAt'>

/** A form over some of the site's fields; saving sends only those fields. `prepare` fixes up the patch and says whether to save. */
function useSiteForm<K extends keyof SiteDraft>(
  fields: readonly K[],
  prepare?: (patch: Pick<SiteDraft, K>) => boolean,
) {
  const { client, site, onSiteChange } = useDashboard()
  const [draft, setDraft] = useState<Site>(site)
  const [outcome, run] = useOutcome()
  const set = <F extends K>(key: F, value: Site[F]): void => setDraft({ ...draft, [key]: value })
  const submit = (event: SubmitEvent): void => {
    event.preventDefault()
    const patch = {} as Pick<SiteDraft, K>
    for (const key of fields) patch[key] = draft[key]
    if (prepare && !prepare(patch)) return
    run(client.updateSite(site.id, patch).then(onSiteChange), 'Settings saved')
  }
  return { draft, set, submit, outcome }
}

const SaveButton = () => (
  <button type="submit" className="analytik-button" data-variant="primary">
    Save
  </button>
)

/** Name, domain, time zone and currency. */
export function SiteSettings() {
  const [touched, setTouched] = useState(false)
  const { draft, set, submit, outcome } = useSiteForm(['name', 'domain', 'timezone', 'currency'], (patch) => {
    setTouched(true)
    const domain = domainProblem(patch.domain) ? null : cleanDomain(patch.domain)
    if (!domain) return false
    patch.domain = domain
    return true
  })
  return (
    <Card title="Site" description="How the site is named, where its events come from and how its reports are dated.">
      <form className="analytik-form" onSubmit={submit}>
        <div className="analytik-row">
          <Field label="Name">
            <input
              className="analytik-input"
              value={draft.name}
              onChange={(e) => set('name', e.target.value)}
              required
            />
          </Field>
          <DomainField
            value={draft.domain}
            onChange={(domain) => set('domain', domain)}
            hint="Events are accepted from this domain and its subdomains only."
            touched={touched}
            onBlur={() => setTouched(true)}
          />
        </div>
        <div className="analytik-row">
          <TimeZoneSelect
            label="Timezone"
            hint="Days and hours in reports start in this zone."
            value={draft.timezone}
            onChange={(timezone) => set('timezone', timezone)}
          />
          <CurrencySelect
            label="Currency"
            hint="Revenue is reported in this currency."
            value={draft.currency}
            onChange={(currency) => set('currency', currency)}
          />
        </div>
        <Actions outcome={outcome}>
          <SaveButton />
        </Actions>
      </form>
    </Card>
  )
}

/** Privacy mode, retention, ignored addresses and localhost. */
export function PrivacySettings() {
  const { site } = useDashboard()
  const [ignoredIps, setIgnoredIps] = useState(site.ignoredIps.join('\n'))
  const { draft, set, submit, outcome } = useSiteForm(
    ['privacyMode', 'retentionDays', 'ignoredIps', 'allowLocalhost'],
    (patch) => {
      patch.ignoredIps = ignoredIps
        .split(/[\s,]+/)
        .map((ip) => ip.trim())
        .filter(Boolean)
      return true
    },
  )
  return (
    <Card title="Privacy and data collection" description="What the tracker may store, and which visits are counted.">
      <form className="analytik-form" onSubmit={submit}>
        <fieldset className="analytik-choices">
          <legend className="analytik-field-label">Privacy mode</legend>
          <div className="analytik-choice-grid">
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
          </div>
        </fieldset>
        <div className="analytik-row">
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
        </div>
        <Switch checked={draft.allowLocalhost} onChange={(on) => set('allowLocalhost', on)}>
          Accept events from localhost (for testing; turn off once live)
        </Switch>
        <Actions outcome={outcome}>
          <SaveButton />
        </Actions>
      </form>
    </Card>
  )
}

type UpdateChoice = '60' | '240' | '0'

// How often an open page reports that the visitor is still there. Each report is a request, which counts on hosts
// that bill per request.
const UPDATE_CHOICES: { value: UpdateChoice; label: string; description: string }[] = [
  {
    value: '240',
    label: 'Every 4 minutes',
    description: 'Readers stay in the live view; about a quarter of the requests of every minute.',
  },
  {
    value: '60',
    label: 'Every minute',
    description: 'The most exact time on page if a browser closes without saying so; the most requests.',
  },
  {
    value: '0',
    label: 'Only when leaving',
    description: 'The fewest requests; readers drop out of the live view after five quiet minutes.',
  },
]

export function SnippetGenerator() {
  const { site, apiUrl } = useDashboard()
  const [mode, setMode] = useState<PrivacyMode>(site.privacyMode)
  const [requireInteraction, setRequireInteraction] = useState(true)
  const [autoOutbound, setAutoOutbound] = useState(true)
  const [keepQuery, setKeepQuery] = useState('')
  const [updates, setUpdates] = useState<UpdateChoice>('240')
  const snippet = buildSnippet({
    site: site.id,
    apiUrl,
    mode,
    requireInteraction,
    autoOutbound,
    keepQuery,
    pingInterval: Number(updates),
    debug: false,
  })

  return (
    <Card title="Tracking snippet" description="Paste it into the head of every page.">
      <div className="analytik-row">
        <Select label="Mode" value={mode} options={MODES} onChange={setMode} />
        <Field label="Keep query parameters" hint="Comma-separated, besides utm_*, ref and source.">
          <input className="analytik-input" value={keepQuery} onChange={(e) => setKeepQuery(e.target.value)} />
        </Field>
        <Select label="Activity updates" value={updates} options={UPDATE_CHOICES} onChange={setUpdates} />
      </div>
      <div className="analytik-switches">
        <Switch checked={requireInteraction} onChange={setRequireInteraction}>
          Wait for an interaction or 3 seconds on screen before counting (filters bots)
        </Switch>
        <Switch checked={autoOutbound} onChange={setAutoOutbound}>
          Track clicks on outbound links
        </Switch>
      </div>
      <pre className="analytik-code" aria-label="Snippet">
        <code>{snippet}</code>
      </pre>
      <Actions>
        <CopyButton text={snippet} label="Copy snippet" />
      </Actions>
    </Card>
  )
}

const CAMPAIGN_FIELDS: { key: keyof CampaignParams; label: string; param: string; meaning: string; example: string }[] =
  [
    {
      key: 'source',
      label: 'Source (required)',
      param: 'utm_source',
      meaning: 'Where the click comes from',
      example: 'newsletter',
    },
    { key: 'medium', label: 'Medium', param: 'utm_medium', meaning: 'The kind of channel', example: 'email' },
    {
      key: 'campaign',
      label: 'Campaign',
      param: 'utm_campaign',
      meaning: 'The promotion it belongs to',
      example: 'spring_sale',
    },
    {
      key: 'term',
      label: 'Term',
      param: 'utm_term',
      meaning: 'A paid keyword, shown as Keyword',
      example: 'web analytics',
    },
    {
      key: 'content',
      label: 'Content',
      param: 'utm_content',
      meaning: 'Which link or ad variant',
      example: 'header_button',
    },
  ]

/** The link with its campaign parameters highlighted. */
function CampaignUrl({ url }: { url: string }) {
  return (
    <code className="analytik-url" aria-label="Campaign link">
      {url.split(/(?=[?&#])/).map((part, index) => (
        <span key={index} className={/^[?&]utm_/.test(part) ? 'analytik-url-param' : undefined}>
          {part}
        </span>
      ))}
    </code>
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

  return (
    <Card
      title="Campaign link builder"
      description="Tag the links you share, so visits through them are credited to the right campaign."
    >
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
        {CAMPAIGN_FIELDS.map(({ key, label, example }) => (
          <Field key={key} label={label}>
            <input
              className="analytik-input"
              value={params[key]}
              placeholder={example}
              onChange={(e) => setParams({ ...params, [key]: e.target.value })}
            />
          </Field>
        ))}
      </div>
      <section className="analytik-preview" aria-label="Preview">
        <h3 className="analytik-eyebrow">Preview</h3>
        {url ? <CampaignUrl url={url} /> : <p className="analytik-muted">Enter a full page URL and a source.</p>}
        <dl className="analytik-params">
          {CAMPAIGN_FIELDS.map(({ key, param, meaning }) => (
            <div key={key} data-set={params[key].trim() ? '' : undefined}>
              <dt>
                <code>{param}</code>
              </dt>
              <dd>{params[key].trim() || '—'}</dd>
              <dd className="analytik-field-hint">{meaning}</dd>
            </div>
          ))}
        </dl>
        <p className="analytik-field-hint">
          Visitors who open this link are counted under Sources, in the Source, Medium, Campaign, Keyword and Content
          tabs.
        </p>
      </section>
      {url && (
        <Actions>
          <CopyButton text={url} label="Copy link" />
        </Actions>
      )}
    </Card>
  )
}

function ApiKey() {
  const { client, site } = useDashboard()
  const [key, setKey] = useState<string>()
  const [outcome, run] = useOutcome()
  return (
    <Card
      title="API key"
      description={
        <>
          For server-side goals and payments (<code>Authorization: Bearer …</code>).
        </>
      }
    >
      {key && (
        <>
          <pre className="analytik-code" aria-label="New API key">
            <code>{key}</code>
          </pre>
          <p className="analytik-muted">Store it now: it is shown only once.</p>
        </>
      )}
      <Actions outcome={outcome}>
        {key && <CopyButton text={key} label="Copy key" />}
        <ConfirmButton
          label="Rotate key"
          title="Rotate the API key?"
          description="A new key is created and the current one stops working at once. Servers that still send the old key are refused until you update them."
          confirmLabel="Rotate key"
          onConfirm={() =>
            run(
              client.rotateKey(site.id).then((r) => setKey(r.apiKey)),
              'New key created',
            )
          }
        />
      </Actions>
    </Card>
  )
}

const PROVIDERS: { value: PaymentProvider; label: string }[] = [
  { value: 'stripe', label: 'Stripe' },
  { value: 'dodo', label: 'Dodo Payments' },
  { value: 'lemonsqueezy', label: 'Lemon Squeezy' },
]

function Webhook({ provider, label }: { provider: PaymentProvider; label: string }) {
  const { client, site, apiUrl, onSiteChange } = useDashboard()
  const [secret, setSecret] = useState('')
  const [outcome, run] = useOutcome()
  const url = `${apiUrl}/webhooks/${provider}/${encodeURIComponent(site.id)}`
  const connected = site.webhooks?.[provider] ?? false
  const submit = (event: SubmitEvent): void => {
    event.preventDefault()
    run(
      client.updateSite(site.id, { webhookSecrets: { [provider]: secret } }).then((updated) => {
        setSecret('')
        onSiteChange(updated)
      }),
      `${label} secret saved`,
    )
  }
  return (
    <form className="analytik-form analytik-webhook" onSubmit={submit}>
      <div className="analytik-webhook-head">
        <h3>
          <span className="analytik-provider" aria-hidden="true">
            <Logo name={label} />
          </span>
          {label}
        </h3>
        <span className="analytik-badge" data-trend={connected ? 'up' : 'flat'}>
          {connected ? 'Secret saved' : 'Not set up'}
        </span>
      </div>
      <div className="analytik-row">
        <Field label="Endpoint URL">
          <input className="analytik-input analytik-mono" value={url} readOnly />
        </Field>
        <Field label="Signing secret">
          <input
            className="analytik-input"
            type="password"
            autoComplete="off"
            value={secret}
            placeholder={connected ? 'Saved; enter a new one to replace it' : undefined}
            onChange={(e) => setSecret(e.target.value)}
            required
          />
        </Field>
      </div>
      <Actions outcome={outcome}>
        <CopyButton text={url} label="Copy URL" />
        <button type="submit" className="analytik-button">
          Save secret
        </button>
      </Actions>
    </form>
  )
}

function PaymentWebhooks() {
  return (
    <Card
      title="Payment webhooks"
      description="Point your payment provider at the endpoint and paste its signing secret. Payments are matched to the visits that led to them."
    >
      {PROVIDERS.map((p) => (
        <Webhook key={p.value} provider={p.value} label={p.label} />
      ))}
    </Card>
  )
}

function DataExport() {
  const { client, site } = useDashboard()
  const [outcome, run] = useOutcome()
  const formats: ExportFormat[] = ['json', 'csv']
  return (
    <Card title="Export and maintenance" description="Download everything stored for this site, or re-run attribution.">
      <Actions outcome={outcome}>
        <button
          type="button"
          className="analytik-button"
          onClick={() => run(client.rematch(site.id), 'Payment attribution re-run')}
        >
          Re-run payment attribution
        </button>
        {formats.map((format) => (
          <a key={format} className="analytik-button" href={client.exportUrl(site.id, format)} download>
            Export {format.toUpperCase()}
          </a>
        ))}
      </Actions>
    </Card>
  )
}

function DataDeletion() {
  const { client, site } = useDashboard()
  const [before, setBefore] = useState('')
  const [outcome, run] = useOutcome()
  return (
    <Card
      title="Delete old data"
      description="Removes the visits recorded before a day. Older payments stay for revenue, without customer details."
    >
      <div className="analytik-row">
        <DatePicker label="Delete data before" value={before} onChange={setBefore} />
      </div>
      <Actions outcome={outcome}>
        <ConfirmButton
          label="Delete"
          title={`Delete everything before ${before}?`}
          disabled={!before}
          description="Events and sessions from before that day are removed for good, and older payments lose their customer details. This cannot be undone."
          confirmLabel="Delete data"
          onConfirm={() => run(client.purge(site.id, new Date(`${before}T00:00:00`).getTime()), 'Data deleted')}
        />
      </Actions>
    </Card>
  )
}

interface Section {
  value: string
  label: string
  icon: IconName
  content: ComponentType
  /** Set apart from the site's own settings, e.g. the test data tools. */
  tone?: 'debug'
}

const SECTIONS: readonly [Section, ...Section[]] = [
  {
    value: 'general',
    label: 'General',
    icon: 'sliders',
    content: () => (
      <>
        <SiteSettings />
        <SiteLifecycle />
      </>
    ),
  },
  { value: 'privacy', label: 'Privacy', icon: 'shield', content: PrivacySettings },
  { value: 'tracking', label: 'Tracking code', icon: 'code', content: SnippetGenerator },
  { value: 'campaigns', label: 'Campaign links', icon: 'link', content: CampaignLinkBuilder },
  {
    value: 'payments',
    label: 'Payments and API',
    icon: 'card',
    content: () => (
      <>
        <PaymentWebhooks />
        <ApiKey />
      </>
    ),
  },
  {
    value: 'data',
    label: 'Data',
    icon: 'database',
    content: () => (
      <>
        <DataExport />
        <DataDeletion />
      </>
    ),
  },
  { value: 'appearance', label: 'Appearance', icon: 'theme', content: ThemeSettings },
  { value: 'formatting', label: 'Formatting', icon: 'format', content: FormatSettings },
  { value: 'debug', label: 'Debug', icon: 'bug', content: DebugSettings, tone: 'debug' },
]

export type SettingsSection =
  'general' | 'privacy' | 'tracking' | 'campaigns' | 'payments' | 'data' | 'appearance' | 'formatting' | 'debug'

/**
 * Site settings in sections: a list on the left (a scrolling row on phones) and the chosen section's cards. `section`
 * picks the one shown first, e.g. the tracking code right after a site was added.
 */
export function Settings({ section: initial }: { section?: SettingsSection } = {}) {
  const { client } = useDashboard()
  // The debug tools write made-up data, so the section only shows on a server that opted in with `debug: true`.
  const debug = useResource('debug', () => client.debug().catch(() => ({ enabled: false })))
  const sections = SECTIONS.filter((s) => s.value !== 'debug' || debug.data?.enabled)
  const [section, setSection] = useState<string>(initial ?? SECTIONS[0].value)
  const current = sections.find((s) => s.value === section) ?? SECTIONS[0]
  const Content = current.content
  return (
    <View>
      <div className="analytik-settings">
        <nav className="analytik-settings-nav" aria-label="Settings">
          <ul>
            {sections.map(({ value, label, icon, tone }) => (
              <li key={value} data-tone={tone}>
                <button
                  type="button"
                  className="analytik-nav-item"
                  aria-current={value === section ? 'page' : undefined}
                  onClick={() => setSection(value)}
                >
                  {value === section && (
                    <motion.span className="analytik-nav-pill" layoutId="analytik-settings-pill" aria-hidden="true" />
                  )}
                  <span className="analytik-settings-label">
                    <Icon name={icon} />
                    {label}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={section}
            className="analytik-settings-body"
            variants={stagger}
            initial="hidden"
            animate="show"
            exit="exit"
          >
            <Content />
          </motion.div>
        </AnimatePresence>
      </div>
    </View>
  )
}
