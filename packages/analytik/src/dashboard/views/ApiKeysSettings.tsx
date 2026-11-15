import { useId, useState } from 'react'

import { normalizeAllowlist } from '../../shared/ip-allowlist'
import type { ApiKey, ApiKeyEvent, ApiKeyEventType, ApiKeyScope, Site } from '../../shared/types'
import { useDashboard } from '../context'
import { useResource } from '../data'
import { formatDateTime } from '../format'
import { msg, t } from '../i18n'
import { Actions, Card, CopyButton, Field, Status, useOutcome } from '../ui'
import { Dialog } from '../ui/dialog'
import { MultiSelect } from '../ui/multi-select'
import { PasswordDialog } from '../ui/password-dialog'
import { Select } from '../ui/select'

const SCOPES: { value: ApiKeyScope; label: string }[] = [
  { value: 'read', label: msg('Read only') },
  { value: 'write', label: msg('Read and write') },
]

const EXPIRIES = [
  { value: '', label: msg('Never') },
  { value: '30', label: msg('After 30 days') },
  { value: '90', label: msg('After 90 days') },
  { value: '365', label: msg('After 1 year') },
]

const GRACES = [
  { value: '0', label: msg('Stop the old key at once') },
  { value: '1', label: msg('Let the old key work for 1 hour') },
  { value: '24', label: msg('Let the old key work for 24 hours') },
  { value: '168', label: msg('Let the old key work for 7 days') },
]

const STATES: Record<ApiKey['state'], string> = {
  active: msg('Active'),
  disabled: msg('Disabled'),
  expired: msg('Expired'),
}

const EVENT_LABELS: Record<ApiKeyEventType, string> = {
  created: msg('Created'),
  rolled: msg('Rolled'),
  disabled: msg('Disabled'),
  enabled: msg('Enabled'),
  deleted: msg('Deleted'),
  denied: msg('Refused'),
  denied_ip: msg('Refused address'),
  allowlist_changed: msg('Addresses changed'),
}

/** Whether the admin signs in with a password, and so must type it again before a key changes. */
function useNeedsPassword(): boolean {
  const { client } = useDashboard()
  const me = useResource('me', () => client.me())
  return me.data?.login !== 'custom'
}

const lines = (text: string): string[] =>
  text
    .split(/[\n,;]+/)
    .map((line) => line.trim())
    .filter(Boolean)

/** The list a text field holds, or what is wrong with it. The server applies the same rules. */
function readAddresses(text: string): { list: string[]; error?: string; anyAddress: boolean } {
  try {
    const list = normalizeAllowlist(lines(text))
    return { list, anyAddress: list.includes('0.0.0.0/0') || list.includes('::/0') }
  } catch (error) {
    return { list: [], error: error instanceof Error ? error.message : String(error), anyAddress: false }
  }
}

/** One address or range per line, checked as you type, with the address the server sees this browser at as a hint. */
function AddressesField({
  value,
  onChange,
  error,
  anyAddress,
}: {
  value: string
  onChange: (value: string) => void
  error: string | undefined
  anyAddress: boolean
}) {
  const { client } = useDashboard()
  const mine = useResource<{ ip: string | null }>('my-ip', () => client.myIp())
  const errorId = useId()
  return (
    <Field
      label={t('Allowed addresses')}
      hint={
        <>
          {t('One address or range per line, such as 203.0.113.7 or 203.0.113.0/24. Leave empty to allow any address.')}
          {anyAddress && ` ${t('This allows any address.')}`}
          {mine.data?.ip && ` ${t('Your address as the server sees it: {ip}', { ip: mine.data.ip })}`}
        </>
      }
      error={error ? { id: errorId, text: error } : null}
    >
      <textarea
        className="analytik-input analytik-mono"
        rows={3}
        spellCheck={false}
        autoCapitalize="off"
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  )
}

/** The address a script calls: the dashboard's API address with the stable `/v1` prefix. */
function keyAddress(apiUrl: string): string {
  const base = apiUrl.replace(/\/+$/, '')
  return `${/^https?:/.test(base) ? base : `${window.location.origin}${base}`}/v1`
}

/** A new or rolled secret, shown once. Closing the dialog drops it from the page. */
function SecretDialog({
  secret,
  onClose,
}: {
  secret: { key: ApiKey; secret: string } | undefined
  onClose: () => void
}) {
  const { apiUrl } = useDashboard()
  const command = secret ? `curl -H "Authorization: Bearer ${secret.secret}" ${keyAddress(apiUrl)}/whoami` : ''
  return (
    <Dialog open={!!secret} onOpenChange={(open) => !open && onClose()} title={t('Your API key')}>
      {secret && (
        <div className="analytik-form">
          <p className="analytik-dialog-text">
            {t('Copy the key now. For safety it is not shown again. Keep it on a server, never in a web page.')}
          </p>
          <div className="analytik-row analytik-secret-row">
            <input
              className="analytik-input analytik-mono"
              readOnly
              value={secret.secret}
              aria-label={t('API key')}
              onFocus={(e) => e.currentTarget.select()}
            />
            <CopyButton text={secret.secret} label={t('Copy key')} />
          </div>
          <p className="analytik-muted">{t('Try it:')}</p>
          <div className="analytik-row analytik-secret-row">
            <input
              className="analytik-input analytik-mono"
              readOnly
              value={command}
              aria-label={t('Example request')}
              onFocus={(e) => e.currentTarget.select()}
            />
            <CopyButton text={command} label={t('Copy command')} />
          </div>
          <div className="analytik-actions analytik-card-actions">
            <button type="button" className="analytik-button" data-variant="primary" onClick={onClose}>
              {t('Done')}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  )
}

function NewKey({
  sites,
  onCreated,
}: {
  sites: Site[]
  onCreated: (created: { key: ApiKey; secret: string }) => void
}) {
  const { client } = useDashboard()
  const needsPassword = useNeedsPassword()
  const [label, setLabel] = useState('')
  const [scope, setScope] = useState<ApiKeyScope>('read')
  const [siteIds, setSiteIds] = useState<string[]>([])
  const [expires, setExpires] = useState('')
  const [addresses, setAddresses] = useState('')
  const [asking, setAsking] = useState(false)
  const checked = readAddresses(addresses)
  const summary =
    siteIds.length === 0 || siteIds.length === sites.length
      ? t('All sites')
      : t('{count, plural, one {# site} other {# sites}}', { count: siteIds.length })
  return (
    <form
      className="analytik-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (!checked.error) setAsking(true)
      }}
    >
      <div className="analytik-row">
        <Field label={t('Name')}>
          <input
            className="analytik-input"
            required
            maxLength={80}
            placeholder={t('Grafana, nightly report…')}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>
        <Select
          label={t('Access')}
          value={scope}
          options={SCOPES.map((o) => ({ ...o, label: t(o.label) }))}
          onChange={setScope}
        />
        <MultiSelect
          label={t('Sites')}
          options={sites.map((s) => ({ value: s.id, label: s.name }))}
          chosen={siteIds}
          onChange={setSiteIds}
          summary={summary}
        />
        <Select
          label={t('Expires')}
          value={expires}
          options={EXPIRIES.map((o) => ({ ...o, label: t(o.label) }))}
          onChange={setExpires}
        />
      </div>
      <AddressesField value={addresses} onChange={setAddresses} error={checked.error} anyAddress={checked.anyAddress} />
      <Actions>
        <button type="submit" className="analytik-button" data-variant="primary">
          {t('Create key')}
        </button>
      </Actions>
      <PasswordDialog
        open={asking}
        onOpenChange={setAsking}
        title={t('Create an API key?')}
        description={
          scope === 'write'
            ? t(
                'Anyone who holds the key can read your statistics and change settings. Type the admin password to continue.',
              )
            : t('Anyone who holds the key can read your statistics. Type the admin password to continue.')
        }
        confirmLabel={t('Create key')}
        needsPassword={needsPassword}
        onSubmit={(password) =>
          client
            .createApiKey(
              {
                label: label.trim(),
                scope,
                siteIds: siteIds.length === sites.length ? [] : siteIds,
                expiresInDays: expires === '' ? null : Number(expires),
                ...(checked.list.length > 0 && { ipAllowlist: checked.list }),
              },
              needsPassword ? password : undefined,
            )
            .then((created) => {
              setLabel('')
              setAddresses('')
              onCreated(created)
            })
        }
      />
    </form>
  )
}

function KeyRow({
  apiKey,
  onChange,
  onSecret,
  run,
}: {
  apiKey: ApiKey
  onChange: () => void
  onSecret: (created: { key: ApiKey; secret: string }) => void
  run: ReturnType<typeof useOutcome>[1]
}) {
  const { client, site } = useDashboard()
  const needsPassword = useNeedsPassword()
  const [dialog, setDialog] = useState<'roll' | 'enable' | 'delete' | 'addresses'>()
  const [addresses, setAddresses] = useState('')
  const checked = readAddresses(addresses)
  const [grace, setGrace] = useState('0')
  const close = (open: boolean): void => {
    if (!open) setDialog(undefined)
  }
  const editAddresses = (): void => {
    setAddresses(apiKey.ipAllowlist.join('\n'))
    setDialog('addresses')
  }
  const pass = (password: string): string | undefined => (needsPassword ? password : undefined)
  const sitesText =
    apiKey.siteIds.length === 0
      ? t('All sites')
      : t('{count, plural, one {# site} other {# sites}}', { count: apiKey.siteIds.length })
  return (
    <li data-active={apiKey.state === 'active' ? '' : undefined}>
      <div>
        <strong>{apiKey.label || apiKey.prefix}</strong>
        <span className="analytik-muted">
          <span className="analytik-mono">{apiKey.prefix}…</span>
          {` · ${t(STATES[apiKey.state])} · ${t(SCOPES.find((s) => s.value === apiKey.scope)?.label ?? apiKey.scope)} · ${sitesText}`}
          {` · ${apiKey.ipAllowlist.length === 0 ? t('Any address') : t('{count, plural, one {# address} other {# addresses}}', { count: apiKey.ipAllowlist.length })}`}
          {` · ${apiKey.lastUsedAt === null ? t('Never used') : t('Used {when}', { when: formatDateTime(apiKey.lastUsedAt, site.timezone) })}`}
          {apiKey.expiresAt !== null &&
            ` · ${t('Expires {when}', { when: formatDateTime(apiKey.expiresAt, site.timezone) })}`}
          {apiKey.previousUntil !== null &&
            ` · ${t('Old key works until {when}', { when: formatDateTime(apiKey.previousUntil, site.timezone) })}`}
        </span>
      </div>
      <div className="analytik-row analytik-key-actions">
        <button type="button" className="analytik-button" onClick={editAddresses}>
          {t('Addresses')}
        </button>
        <button type="button" className="analytik-button" onClick={() => setDialog('roll')}>
          {t('Roll')}
        </button>
        {apiKey.state === 'disabled' ? (
          <button type="button" className="analytik-button" onClick={() => setDialog('enable')}>
            {t('Enable')}
          </button>
        ) : (
          <button
            type="button"
            className="analytik-button"
            onClick={() => run(client.disableApiKey(apiKey.id).then(onChange), t('Key disabled'))}
          >
            {t('Disable')}
          </button>
        )}
        <button type="button" className="analytik-button" data-variant="danger" onClick={() => setDialog('delete')}>
          {t('Delete')}
        </button>
      </div>
      <PasswordDialog
        open={dialog === 'addresses'}
        onOpenChange={close}
        title={t('Change allowed addresses?')}
        description={t(
          'Only these addresses can use the key. An empty list lets any address use it. Type the admin password to continue.',
        )}
        confirmLabel={t('Save addresses')}
        needsPassword={needsPassword}
        onSubmit={(password) => {
          if (checked.error) return Promise.reject(new Error(checked.error))
          return client.setApiKeyAllowlist(apiKey.id, checked.list, pass(password)).then(onChange)
        }}
      >
        <AddressesField
          value={addresses}
          onChange={setAddresses}
          error={checked.error}
          anyAddress={checked.anyAddress}
        />
      </PasswordDialog>
      <PasswordDialog
        open={dialog === 'roll'}
        onOpenChange={close}
        title={t('Roll this key?')}
        description={t('A new key replaces this one. Update the script that uses it before the old key stops.')}
        confirmLabel={t('Roll key')}
        needsPassword={needsPassword}
        onSubmit={(password) =>
          client.rollApiKey(apiKey.id, Number(grace), pass(password)).then((created) => {
            onChange()
            onSecret(created)
          })
        }
      >
        <Select
          label={t('The old key')}
          value={grace}
          options={GRACES.map((o) => ({ ...o, label: t(o.label) }))}
          onChange={setGrace}
        />
      </PasswordDialog>
      <PasswordDialog
        open={dialog === 'enable'}
        onOpenChange={close}
        title={t('Enable this key?')}
        description={t('Scripts that use it can read your statistics again.')}
        confirmLabel={t('Enable')}
        needsPassword={needsPassword}
        onSubmit={(password) => client.enableApiKey(apiKey.id, pass(password)).then(onChange)}
      />
      <PasswordDialog
        open={dialog === 'delete'}
        onOpenChange={close}
        title={t('Delete this key?')}
        description={t('Scripts that use it stop working at once. This cannot be undone.')}
        confirmLabel={t('Delete')}
        tone="danger"
        needsPassword={needsPassword}
        onSubmit={(password) => client.deleteApiKey(apiKey.id, pass(password)).then(onChange)}
      />
    </li>
  )
}

function Activity({ events }: { events: ApiKeyEvent[] }) {
  const { site } = useDashboard()
  if (!events.length) return <p className="analytik-muted">{t('Nothing has happened yet.')}</p>
  return (
    <ul className="analytik-share-list">
      {events.slice(0, 20).map((event) => (
        <li key={event.id} data-active="">
          <div>
            <strong>{t(EVENT_LABELS[event.type])}</strong>
            <span className="analytik-muted">
              {event.label || event.keyId}
              {event.detail && ` · ${event.detail}`}
              {` · ${formatDateTime(event.at, site.timezone)}`}
            </span>
          </div>
        </li>
      ))}
    </ul>
  )
}

/** API keys for scripts and tools: create several, roll, disable and delete them, each step behind the admin password. */
export function ApiKeysSettings() {
  const { client } = useDashboard()
  const keys = useResource<ApiKey[]>('api-keys', () => client.apiKeys())
  const events = useResource<ApiKeyEvent[]>('api-key-events', () => client.apiKeyEvents())
  const sites = useResource<Site[]>('api-key-sites', () => client.sites())
  const [secret, setSecret] = useState<{ key: ApiKey; secret: string }>()
  const [outcome, run] = useOutcome()
  const reload = (): void => {
    keys.reload()
    events.reload()
  }
  return (
    <>
      <Card
        title={t('API keys')}
        description={t(
          'Let a script or another tool read your statistics with a key of its own. Each key can be limited to some sites, switched off or replaced without touching the others.',
        )}
      >
        <NewKey
          sites={sites.data ?? []}
          onCreated={(created) => {
            reload()
            setSecret(created)
          }}
        />
        <Status loading={keys.loading && !keys.data} error={keys.error}>
          {keys.data &&
            (keys.data.length === 0 ? (
              <p className="analytik-muted">{t('No API keys yet.')}</p>
            ) : (
              <>
                <ul className="analytik-share-list">
                  {keys.data.map((apiKey) => (
                    <KeyRow key={apiKey.id} apiKey={apiKey} onChange={reload} onSecret={setSecret} run={run} />
                  ))}
                </ul>
                <Actions outcome={outcome}>{null}</Actions>
              </>
            ))}
        </Status>
      </Card>
      <Card
        title={t('Key activity')}
        description={t('Keys created, rolled, switched off or deleted, and calls a key was refused.')}
      >
        <Status loading={events.loading && !events.data} error={events.error}>
          {events.data && <Activity events={events.data} />}
        </Status>
      </Card>
      <SecretDialog secret={secret} onClose={() => setSecret(undefined)} />
    </>
  )
}
