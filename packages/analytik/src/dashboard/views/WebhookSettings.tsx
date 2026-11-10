import { type SubmitEvent, useState } from 'react'

import { WEBHOOK_EVENTS, type Webhook, type WebhookEvent, type WebhookFormat } from '../../shared/types'
import { useDashboard } from '../context'
import { useResource } from '../data'
import { formatDateTime } from '../format'
import { msg, t } from '../i18n'
import { Actions, Card, ConfirmButton, CopyButton, Field, Status, useOutcome } from '../ui'
import { MultiSelect } from '../ui/multi-select'
import { Select } from '../ui/select'

const EVENT_LABELS: Record<WebhookEvent, string> = { goal: msg('Goals'), payment: msg('Payments') }

const FORMATS: { value: WebhookFormat; label: string }[] = [
  { value: 'json', label: msg('Signed JSON') },
  { value: 'chat', label: msg('Chat message') },
]

function NewWebhook({ onCreated }: { onCreated: () => void }) {
  const { client, site } = useDashboard()
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<WebhookEvent[]>([...WEBHOOK_EVENTS])
  const [format, setFormat] = useState<WebhookFormat>('json')
  const [secret, setSecret] = useState('')
  const [outcome, run] = useOutcome()
  const submit = (event: SubmitEvent): void => {
    event.preventDefault()
    run(
      client.createWebhook(site.id, { url: url.trim(), events, format }).then((created) => {
        setSecret(created.secret)
        setUrl('')
        onCreated()
      }),
      t('Webhook added'),
    )
  }
  return (
    <form className="analytik-form" onSubmit={submit}>
      <div className="analytik-row">
        <Field label={t('Address')}>
          <input
            className="analytik-input"
            type="url"
            required
            placeholder="https://"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </Field>
        <Select
          label={t('Format')}
          value={format}
          options={FORMATS.map((o) => ({ ...o, label: t(o.label) }))}
          onChange={setFormat}
        />
        <MultiSelect
          label={t('Events')}
          options={WEBHOOK_EVENTS.map((value) => ({ value, label: t(EVENT_LABELS[value]) }))}
          chosen={events}
          onChange={(values) => setEvents(values as WebhookEvent[])}
          summary={events.map((e) => t(EVENT_LABELS[e])).join(', ')}
        />
      </div>
      <Actions outcome={outcome}>
        <button type="submit" className="analytik-button" data-variant="primary" disabled={events.length === 0}>
          {t('Add webhook')}
        </button>
      </Actions>
      {secret && (
        <div className="analytik-share-created" role="status">
          <p>{t('Copy the secret now. For safety it is not shown again.')}</p>
          <div className="analytik-row">
            <input
              className="analytik-input analytik-mono"
              readOnly
              value={secret}
              aria-label={t('Signing secret')}
              onFocus={(e) => e.currentTarget.select()}
            />
            <CopyButton text={secret} label={t('Copy secret')} />
          </div>
        </div>
      )}
    </form>
  )
}

function WebhookList({ webhooks, onChange }: { webhooks: Webhook[]; onChange: () => void }) {
  const { client, site } = useDashboard()
  const [outcome, run] = useOutcome()
  if (!webhooks.length) return <p className="analytik-muted">{t('No webhooks yet.')}</p>
  return (
    <>
      <ul className="analytik-share-list">
        {webhooks.map((hook) => (
          <li key={hook.id} data-active={hook.paused ? undefined : ''}>
            <div>
              <strong>{hook.host}</strong>
              <span className="analytik-muted">
                {hook.events.map((e) => t(EVENT_LABELS[e])).join(', ')}
                {' · '}
                {t(FORMATS.find((f) => f.value === hook.format)?.label ?? hook.format)}
                {hook.paused && ` · ${t('Paused')}`}
                {hook.lastStatus && ` · ${hook.lastStatus}`}
                {hook.lastAt !== null && ` · ${formatDateTime(hook.lastAt, site.timezone)}`}
              </span>
            </div>
            <div className="analytik-row">
              <button
                type="button"
                className="analytik-button"
                onClick={() =>
                  run(
                    client.testWebhook(site.id, hook.id).then((result) => {
                      onChange()
                      return result
                    }),
                    ({ status }) => (status === 'ok' ? t('Test sent') : status),
                  )
                }
              >
                {t('Send test')}
              </button>
              <button
                type="button"
                className="analytik-button"
                onClick={() =>
                  run(client.updateWebhook(site.id, hook.id, { paused: !hook.paused }).then(onChange), t('Done'))
                }
              >
                {hook.paused ? t('Resume') : t('Pause')}
              </button>
              <ConfirmButton
                label={t('Remove')}
                title={t('Remove this webhook?')}
                description={t('Nothing is sent to it any more. This cannot be undone.')}
                onConfirm={() => run(client.deleteWebhook(site.id, hook.id).then(onChange), t('Done'))}
              />
            </div>
          </li>
        ))}
      </ul>
      <Actions outcome={outcome}>{null}</Actions>
    </>
  )
}

/** Signed messages to other services when a goal is reached or a payment arrives. */
export function WebhookSettings() {
  const { client, site } = useDashboard()
  const hooks = useResource<Webhook[]>(`webhooks:${site.id}`, () => client.webhooks(site.id))
  return (
    <Card
      title={t('Outgoing webhooks')}
      description={t(
        'Send a message to another service, such as Slack or your own server, when a goal is reached or a payment arrives.',
      )}
    >
      <NewWebhook onCreated={hooks.reload} />
      <Status loading={hooks.loading && !hooks.data} error={hooks.error}>
        {hooks.data && <WebhookList webhooks={hooks.data} onChange={hooks.reload} />}
      </Status>
    </Card>
  )
}
