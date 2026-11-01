import { type SubmitEvent, useState } from 'react'

import type { EmailSettings as Settings, EmailState, SummaryFrequency } from '../../shared/types'
import { useDashboard } from '../context'
import { useResource } from '../data'
import { msg, t } from '../i18n'
import { Actions, Card, Field, Notice, Status, useOutcome } from '../ui'
import { Select } from '../ui/select'
import { Switch } from '../ui/switch'
import { localTimeZone, TimeZoneSelect } from '../ui/timezone'

const FREQUENCIES: { value: SummaryFrequency; label: string }[] = [
  { value: 'off', label: msg('Off') },
  { value: 'daily', label: msg('Every day') },
  { value: 'weekly', label: msg('Every Monday') },
]

const HOURS = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: `${String(hour).padStart(2, '0')}:00`,
}))

/** Nothing was ever turned on, so the time zone has not been chosen yet and the browser's is the better guess. */
const untouched = (s: Settings): boolean => !s.payments && !s.down && s.summary === 'off' && s.to === ''

function EmailForm({ state }: { state: EmailState }) {
  const { client } = useDashboard()
  const [draft, setDraft] = useState<Settings>({
    ...state.settings,
    ...(untouched(state.settings) && { timezone: localTimeZone() }),
  })
  const [saved, save] = useOutcome()
  const [tested, test] = useOutcome()
  const set = <K extends keyof Settings>(key: K, value: Settings[K]): void => setDraft({ ...draft, [key]: value })
  const recipient = draft.to !== '' ? draft.to : (state.to ?? '')
  const submit = (event: SubmitEvent): void => {
    event.preventDefault()
    save(client.saveEmail(draft), t('Settings saved'))
  }
  return (
    <form className="analytik-form" onSubmit={submit}>
      {!state.configured && (
        <p className="analytik-muted" role="note">
          {t(
            'No email sender is set up on the server, so nothing is sent. Pass an email option to createAnalytik() with a sender: Resend, any HTTP email API or Cloudflare Email.',
          )}
        </p>
      )}
      <Field
        label={t('Send to')}
        hint={state.to && !draft.to ? t('Using the address set on the server: {to}', { to: state.to }) : undefined}
      >
        <input
          className="analytik-input"
          type="email"
          value={draft.to}
          placeholder={state.to ?? 'you@example.com'}
          onChange={(e) => set('to', e.target.value.trim())}
        />
      </Field>
      <Switch checked={draft.payments} onChange={(on) => set('payments', on)}>
        {t('Email me when a payment arrives')}
      </Switch>
      <Switch checked={draft.down} onChange={(on) => set('down', on)}>
        {t('Email me when a site gets no events for 24 hours')}
      </Switch>
      <div className="analytik-row">
        <Select
          label={t('Summary of all sites')}
          value={draft.summary}
          options={FREQUENCIES.map((o) => ({ ...o, label: t(o.label) }))}
          onChange={(value) => set('summary', value)}
        />
        {draft.summary !== 'off' && (
          <Select
            label={t('Send after')}
            value={String(draft.hour)}
            options={HOURS}
            onChange={(value) => set('hour', Number(value))}
          />
        )}
      </div>
      {draft.summary !== 'off' && (
        <TimeZoneSelect
          label={t('Time zone')}
          value={draft.timezone}
          onChange={(zone) => set('timezone', zone)}
          hint={t('The hour and the day or week covered are read in this time zone.')}
        />
      )}
      <Actions outcome={saved}>
        <Notice outcome={tested} />
        <button
          type="button"
          className="analytik-button"
          disabled={!state.configured || !recipient}
          onClick={() => test(client.sendTestEmail(recipient), ({ to }) => t('Test email sent to {to}', { to }))}
        >
          {t('Send test email')}
        </button>
        <button type="submit" className="analytik-button" data-variant="primary">
          {t('Save')}
        </button>
      </Actions>
    </form>
  )
}

/** Owner emails: payment alerts, a summary of all sites and a warning when tracking goes quiet. */
export function EmailSettings() {
  const { client } = useDashboard()
  const state = useResource('email', () => client.email())
  return (
    <Card
      title={t('Email')}
      description={t(
        'Get a message when money arrives, a daily or weekly summary of every site, or a warning when tracking stops. These settings apply to all sites.',
      )}
    >
      <Status loading={state.loading} error={state.error}>
        {state.data && <EmailForm state={state.data} />}
      </Status>
    </Card>
  )
}
