import { type SubmitEvent, useState } from 'react'

import type {
  DefaultsGroup,
  GoalTarget,
  PrivacyMode,
  ShareView,
  Site,
  SiteDefaults,
  TargetPeriod,
} from '../../shared/types'
import { useDashboard } from '../context'
import { useResource } from '../data'
import { msg, t } from '../i18n'
import { Actions, Card, ConfirmButton, CopyButton, Field, Status, useOutcome } from '../ui'
import { MultiSelect } from '../ui/multi-select'
import { CurrencySelect } from '../ui/currency'
import { Select, type SelectOption } from '../ui/select'
import { Switch } from '../ui/switch'
import { TimeZoneSelect } from '../ui/timezone'
import { MODE_INFO } from './privacy-modes'
import { EXPIRIES, LINK_PURPOSES, type LinkPurpose, MAC_APP_VIEWS, shareAddress, ViewsSelect } from './SharingSettings'

const MAX_TARGETS = 20
const DEFAULT_VITALS_SAMPLE = 10

const PERIOD_OPTIONS: SelectOption<TargetPeriod>[] = [
  { value: 'week', label: msg('Week') },
  { value: 'month', label: msg('Month') },
  { value: 'quarter', label: msg('Quarter') },
]

/**
 * Saving and applying for one card of defaults. `patch` reads the card's fields and returns what to send, or nothing
 * when a field is not usable yet. Applying saves first, so the sites get exactly what the card shows.
 */
function useDefaultsCard(group: DefaultsGroup, patch: () => Partial<SiteDefaults> | null) {
  const { client } = useDashboard()
  const [outcome, run] = useOutcome()
  const submit = (event: SubmitEvent): void => {
    event.preventDefault()
    const values = patch()
    if (values) run(client.saveSiteDefaults(values), t('Settings saved'))
  }
  const apply = (): void => {
    const values = patch()
    if (values)
      run(
        client.saveSiteDefaults(values).then(() => client.applySiteDefaults([group])),
        t('Applied to all sites'),
      )
  }
  return { outcome, submit, apply }
}

function CardActions({
  outcome,
  apply,
  count,
}: {
  outcome: ReturnType<typeof useOutcome>[0]
  apply: () => void
  count: number
}) {
  return (
    <Actions outcome={outcome}>
      <ConfirmButton
        label={t('Apply to all sites')}
        title={t('Apply to all sites?')}
        description={t('Every site gets the values on this card, replacing its own. This cannot be undone.')}
        confirmLabel={t('Apply to all sites')}
        tone="plain"
        disabled={count === 0}
        onConfirm={apply}
      />
      <button type="submit" className="analytik-button" data-variant="primary">
        {t('Save')}
      </button>
    </Actions>
  )
}

interface CardProps {
  saved: SiteDefaults
  sites: number
}

function BasicsCard({ saved, sites }: CardProps) {
  const [timezone, setTimezone] = useState(saved.timezone)
  const [currency, setCurrency] = useState(saved.currency)
  const [allowLocalhost, setAllowLocalhost] = useState(saved.allowLocalhost)
  const { outcome, submit, apply } = useDefaultsCard('basics', () => ({ timezone, currency, allowLocalhost }))
  return (
    <Card title={t('Basics')}>
      <form className="analytik-form" onSubmit={submit}>
        <div className="analytik-row">
          <TimeZoneSelect
            label={t('Timezone')}
            hint={t('Days and hours in reports start in this zone.')}
            value={timezone}
            onChange={setTimezone}
          />
          <CurrencySelect
            label={t('Currency')}
            hint={t('Revenue is reported in this currency.')}
            value={currency}
            onChange={setCurrency}
          />
        </div>
        <Switch checked={allowLocalhost} onChange={setAllowLocalhost}>
          {t('Accept events from localhost (for testing; turn off once live)')}
        </Switch>
        <CardActions outcome={outcome} apply={apply} count={sites} />
      </form>
    </Card>
  )
}

function PrivacyCard({ saved, sites }: CardProps) {
  const [mode, setMode] = useState<PrivacyMode>(saved.privacyMode)
  const [retention, setRetention] = useState(saved.retentionDays?.toString() ?? '')
  const [ips, setIps] = useState(saved.ignoredIps.join('\n'))
  const [ignoreAdmins, setIgnoreAdmins] = useState(saved.ignoreAdmins)
  const { outcome, submit, apply } = useDefaultsCard('privacy', () => ({
    privacyMode: mode,
    retentionDays: retention ? Number(retention) : null,
    ignoredIps: ips
      .split(/[\s,]+/)
      .map((ip) => ip.trim())
      .filter(Boolean),
    ignoreAdmins,
  }))
  return (
    <Card title={t('Privacy and data collection')}>
      <form className="analytik-form" onSubmit={submit}>
        <Select
          label={t('Privacy mode')}
          value={mode}
          options={MODE_INFO.map(({ value, label, hint, bannerLabel }) => ({
            value,
            label: t(label),
            description: `${t(hint)} ${t(bannerLabel)}.`,
          }))}
          onChange={setMode}
        />
        <div className="analytik-row">
          <Field label={t('Keep data for (days)')} hint={t('Empty keeps everything.')}>
            <input
              className="analytik-input"
              type="number"
              min={1}
              value={retention}
              onChange={(e) => setRetention(e.target.value)}
            />
          </Field>
          <Field
            label={t('Ignored IP addresses')}
            hint={t(
              'One address or range (203.0.113.0/24) per line. Matching requests are dropped before anything is stored. A shared office address hides its other visitors too.',
            )}
          >
            <textarea className="analytik-input" rows={3} value={ips} onChange={(e) => setIps(e.target.value)} />
          </Field>
        </div>
        <Switch checked={ignoreAdmins} onChange={setIgnoreAdmins}>
          {t('Ignore signed-in admins (only when this dashboard and the tracker are on one origin)')}
        </Switch>
        <CardActions outcome={outcome} apply={apply} count={sites} />
      </form>
    </Card>
  )
}

function TrackingCard({ saved, sites }: CardProps) {
  const [vitalsOn, setVitalsOn] = useState(saved.vitalsSample > 0)
  const [sample, setSample] = useState(String(saved.vitalsSample || DEFAULT_VITALS_SAMPLE))
  const [targets, setTargets] = useState<GoalTarget[]>(saved.targets)
  const { outcome, submit, apply } = useDefaultsCard('tracking', () => ({
    vitalsSample: vitalsOn ? Math.min(100, Math.max(1, Math.round(Number(sample)) || DEFAULT_VITALS_SAMPLE)) : 0,
    // A row without a goal name is a row left empty, not a mistake worth refusing the save for.
    targets: targets.filter((row) => row.goal.trim()),
  }))
  const update = (index: number, change: Partial<GoalTarget>): void =>
    setTargets(targets.map((row, i) => (i === index ? { ...row, ...change } : row)))
  return (
    <Card title={t('Tracking')}>
      <form className="analytik-form" onSubmit={submit}>
        <Switch checked={vitalsOn} onChange={setVitalsOn}>
          {t('Measure Core Web Vitals')}
        </Switch>
        {vitalsOn && (
          <Field label={t('Share of page views measured (%)')}>
            <input
              className="analytik-input"
              type="number"
              min={1}
              max={100}
              step={1}
              inputMode="numeric"
              value={sample}
              onChange={(e) => setSample(e.target.value)}
            />
          </Field>
        )}
        <h3 className="analytik-field-label">{t('Goal targets')}</h3>
        {targets.length === 0 && <p className="analytik-empty">{t('No targets yet')}</p>}
        <div className="analytik-target-rows">
          {targets.map((row, index) => (
            <fieldset key={index} className="analytik-target-row">
              <legend className="analytik-sr-only">{t('Target {number}', { number: index + 1 })}</legend>
              <Field label={t('Goal name')}>
                <input
                  className="analytik-input"
                  value={row.goal}
                  maxLength={100}
                  placeholder="signup"
                  onChange={(e) => update(index, { goal: e.target.value })}
                />
              </Field>
              <Field label={t('Target')}>
                <input
                  className="analytik-input"
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={row.target || ''}
                  placeholder="1000"
                  onChange={(e) => update(index, { target: Math.trunc(Number(e.target.value)) })}
                />
              </Field>
              <Select
                label={t('Period')}
                value={row.period}
                options={PERIOD_OPTIONS.map((o) => ({ ...o, label: t(o.label) }))}
                onChange={(period) => update(index, { period })}
              />
              <button
                type="button"
                className="analytik-button"
                aria-label={t('Remove target {number}', { number: index + 1 })}
                onClick={() => setTargets(targets.filter((_, i) => i !== index))}
              >
                {t('Remove')}
              </button>
            </fieldset>
          ))}
        </div>
        <button
          type="button"
          className="analytik-button"
          disabled={targets.length >= MAX_TARGETS}
          onClick={() => setTargets([...targets, { goal: '', target: 0, period: 'month' }])}
        >
          {t('Add a target')}
        </button>
        <CardActions outcome={outcome} apply={apply} count={sites} />
      </form>
    </Card>
  )
}

/** The sites chosen in a dropdown of checkboxes, with a "select all" on top. */
function SiteMultiSelect({
  sites,
  chosen,
  onChange,
}: {
  sites: Site[]
  chosen: string[]
  onChange: (ids: string[]) => void
}) {
  const summary =
    chosen.length === sites.length && sites.length > 1
      ? t('All sites')
      : chosen.length === 1
        ? (sites.find((s) => s.id === chosen[0])?.name ?? '')
        : t('{count, plural, one {# site} other {# sites}}', { count: chosen.length })
  return (
    <MultiSelect
      label={t('Sites')}
      options={sites.map((site) => ({ value: site.id, label: site.name }))}
      chosen={chosen}
      onChange={onChange}
      summary={summary}
    />
  )
}

/** UTF-8 text as base64url without padding, the way the Mac app reads its bundle of sites. */
function base64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

interface CreatedLink {
  site: Site
  address: string
  token: string
}

// The links made last, kept in memory only: the server holds just a hash of each token, so once they are gone from
// here they cannot be shown again. They survive a switch to another settings page, not a reload.
let lastCreated: { links: CreatedLink[]; purpose: LinkPurpose } = { links: [], purpose: 'mac' }

/** Read-only links for several sites at once, and one text that adds them all to the Mac menu bar app. */
function SharedLinksCard({ sites }: { sites: Site[] }) {
  const { client, apiUrl } = useDashboard()
  const [chosen, setChosen] = useState<string[]>(() => sites.map((s) => s.id))
  const [label, setLabel] = useState('')
  const [expires, setExpires] = useState('')
  const [purpose, setPurpose] = useState<LinkPurpose>(lastCreated.purpose)
  const [views, setViews] = useState<ShareView[]>([])
  const [made, setMade] = useState(lastCreated)
  const created = made.links
  const [outcome, run] = useOutcome()
  const submit = (event: SubmitEvent): void => {
    event.preventDefault()
    const picked = sites.filter((s) => chosen.includes(s.id))
    if (picked.length === 0) return
    run(
      Promise.all(
        picked.map((site) =>
          client
            .createShareLink(site.id, {
              label: label.trim(),
              views: purpose === 'mac' ? [...MAC_APP_VIEWS] : views,
              ...(expires && { expiresInDays: Number(expires) }),
            })
            .then(({ token }): CreatedLink => ({ site, token, address: shareAddress(site.id, token) })),
        ),
      ).then((links) => {
        lastCreated = { links, purpose }
        setMade(lastCreated)
      }),
      t('Link created'),
    )
  }
  const bundle = `analytik-sites:${base64Url(
    JSON.stringify(
      created.map(({ site, token, address }) => ({
        name: site.name,
        serverURL: apiUrl,
        siteId: site.id,
        dashboardURL: address,
        token,
      })),
    ),
  )}`
  return (
    <Card
      title={t('Share links for several sites')}
      description={t(
        'Create a read-only link for each site you choose. For the Mac menu bar app, one text adds them all.',
      )}
    >
      <form className="analytik-form" onSubmit={submit}>
        <SiteMultiSelect sites={sites} chosen={chosen} onChange={setChosen} />
        <div className="analytik-row">
          <Select
            label={t('Link for')}
            value={purpose}
            options={LINK_PURPOSES.map((o) => ({ ...o, label: t(o.label) }))}
            onChange={setPurpose}
          />
          {purpose === 'general' && <ViewsSelect views={views} onChange={setViews} />}
        </div>
        <div className="analytik-row">
          <Field label={t('Name')} hint={t('Who the link is for, so you know which to revoke.')}>
            <input className="analytik-input" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <Select
            label={t('Expires')}
            value={expires}
            options={EXPIRIES.map((o) => ({ ...o, label: t(o.label) }))}
            onChange={setExpires}
          />
        </div>
        <Actions outcome={outcome}>
          <button type="submit" className="analytik-button" data-variant="primary" disabled={chosen.length === 0}>
            {t('Create link')}
          </button>
        </Actions>
      </form>
      {created.length > 0 && (
        <div className="analytik-share-created" role="status">
          <p>{t('Copy the link now. For safety it is not shown again.')}</p>
          {created.map(({ site, address }) => (
            <div key={site.id} className="analytik-row">
              <input
                className="analytik-input analytik-mono"
                readOnly
                value={address}
                aria-label={`${t('Share link')}: ${site.name}`}
                onFocus={(e) => e.currentTarget.select()}
              />
              <CopyButton text={address} label={t('Copy link')} />
            </div>
          ))}
          {made.purpose === 'mac' && (
            <>
              <p>
                {t(
                  'Paste this into the Mac app on any Mac to add all these sites at once. It holds the tokens, so keep it private.',
                )}
              </p>
              <div className="analytik-row">
                <input
                  className="analytik-input analytik-mono"
                  readOnly
                  value={bundle}
                  aria-label={t('Mac app link')}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <CopyButton text={bundle} label={t('Copy Mac app link')} />
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  )
}

/** What a new site starts with, set once for every site, and the button that copies a card onto the sites that exist. */
export function DefaultsSettings() {
  const { client } = useDashboard()
  const defaults = useResource<SiteDefaults>('site-defaults', () => client.siteDefaults())
  const sites = useResource<Site[]>('site-defaults-sites', () => client.sites())
  const count = sites.data?.length ?? 0
  return (
    <>
      <Card
        title={t('Defaults for all sites')}
        description={t(
          'New sites start with these values. “Apply to all sites” copies a card onto the sites you already have.',
        )}
      >
        <Status loading={defaults.loading && !defaults.data} error={defaults.error}>
          {null}
        </Status>
      </Card>
      {defaults.data && (
        <>
          <BasicsCard saved={defaults.data} sites={count} />
          <PrivacyCard saved={defaults.data} sites={count} />
          <TrackingCard saved={defaults.data} sites={count} />
          {sites.data && sites.data.length > 0 && <SharedLinksCard sites={sites.data} />}
        </>
      )}
    </>
  )
}
