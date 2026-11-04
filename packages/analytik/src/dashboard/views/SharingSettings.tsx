import { type SubmitEvent, useState } from 'react'

import { SHARE_VIEWS, type ShareLink, type ShareView } from '../../shared/types'
import { useDashboard } from '../context'
import { useResource } from '../data'
import { formatDateTime } from '../format'
import { msg, t } from '../i18n'
import { Actions, Card, ConfirmButton, CopyButton, Field, Status, useOutcome } from '../ui'
import { Select } from '../ui/select'

const MAC_APP_GUIDE = 'https://analytik-docs.vercel.app/guides/mac-menu-bar#install'

const VIEW_LABELS: Record<ShareView, string> = {
  overview: msg('Overview'),
  sources: msg('Acquisition'),
  pages: msg('Pages'),
  events: msg('Events'),
  sessions: msg('Sessions'),
  bots: msg('Bots'),
  funnels: msg('Funnels'),
  realtime: msg('Live'),
}

export const EXPIRIES = [
  { value: '', label: msg('Never') },
  { value: '7', label: msg('After 7 days') },
  { value: '30', label: msg('After 30 days') },
  { value: '90', label: msg('After 90 days') },
]

/** The address that opens the dashboard read-only: this page, with the site and the token. */
export function shareAddress(siteId: string, token: string): string {
  const url = new URL(location.href)
  url.search = ''
  url.hash = ''
  url.searchParams.set('site', siteId)
  url.searchParams.set('share', token)
  return url.href
}

/**
 * The address the Mac menu bar app reads: the server, the site, the token and the dashboard address in one piece, so
 * the app can fill its form from a paste and open the dashboard. The dashboard address alone doesn't say where the API is.
 */
export function macAppLink(apiUrl: string, site: { id: string; name: string }, token: string): string {
  const params = new URLSearchParams({
    server: apiUrl,
    site: site.id,
    token,
    name: site.name,
    dashboard: shareAddress(site.id, token),
  })
  return `analytik://connect?${params.toString()}`
}

function NewLink({ onCreated }: { onCreated: () => void }) {
  const { client, site, apiUrl } = useDashboard()
  const [label, setLabel] = useState('')
  const [views, setViews] = useState<ShareView[]>([])
  const [expires, setExpires] = useState('')
  const [created, setCreated] = useState<{ address: string; mac: string }>()
  const [outcome, run] = useOutcome()
  const toggle = (view: ShareView): void =>
    setViews(views.includes(view) ? views.filter((v) => v !== view) : [...views, view])
  const submit = (event: SubmitEvent): void => {
    event.preventDefault()
    run(
      client
        .createShareLink(site.id, {
          label: label.trim(),
          views,
          ...(expires && { expiresInDays: Number(expires) }),
        })
        .then(({ token }) => {
          setCreated({ address: shareAddress(site.id, token), mac: macAppLink(apiUrl, site, token) })
          setLabel('')
          onCreated()
        }),
      t('Link created'),
    )
  }
  return (
    <form className="analytik-form" onSubmit={submit}>
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
      <fieldset className="analytik-fieldset">
        <legend className="analytik-field-label">{t('Views the link shows')}</legend>
        <p className="analytik-field-hint">{t('Leave all unchecked to show every view.')}</p>
        <div className="analytik-checks">
          {SHARE_VIEWS.map((view) => (
            <label key={view} className="analytik-check">
              <input type="checkbox" checked={views.includes(view)} onChange={() => toggle(view)} />
              {t(VIEW_LABELS[view])}
            </label>
          ))}
        </div>
      </fieldset>
      <Actions outcome={outcome}>
        <button type="submit" className="analytik-button" data-variant="primary">
          {t('Create link')}
        </button>
      </Actions>
      <p className="analytik-field-hint">
        <a href={MAC_APP_GUIDE} target="_blank" rel="noopener">
          {t('Get the Mac app')}
        </a>
      </p>
      {created && (
        <div className="analytik-share-created" role="status">
          <p>{t('Copy the link now. For safety it is not shown again.')}</p>
          <div className="analytik-row">
            <input
              className="analytik-input analytik-mono"
              readOnly
              value={created.address}
              aria-label={t('Share link')}
              onFocus={(e) => e.currentTarget.select()}
            />
            <CopyButton text={created.address} label={t('Copy link')} />
          </div>
          <p>
            {t(
              'For the Mac menu bar app, choose the Overview and Live views. The Mac app link holds the server address, the site id and the token: copy it and paste it into the app.',
            )}
          </p>
          <div className="analytik-row">
            <input
              className="analytik-input analytik-mono"
              readOnly
              value={created.mac}
              aria-label={t('Mac app link')}
              onFocus={(e) => e.currentTarget.select()}
            />
            <CopyButton text={created.mac} label={t('Copy Mac app link')} />
          </div>
        </div>
      )}
    </form>
  )
}

function status(link: ShareLink, now: number): string {
  if (link.revokedAt !== null) return t('Revoked')
  if (link.expiresAt !== null && link.expiresAt <= now) return t('Expired')
  return link.expiresAt === null ? t('Active') : t('Active until {date}', { date: formatDateTime(link.expiresAt) })
}

function LinkList({ links, onChange }: { links: ShareLink[]; onChange: () => void }) {
  const { client, site } = useDashboard()
  const [outcome, run] = useOutcome()
  const [now] = useState(Date.now)
  if (!links.length) return <p className="analytik-muted">{t('No share links yet.')}</p>
  return (
    <>
      <ul className="analytik-share-list">
        {links.map((link) => {
          const active = link.revokedAt === null && (link.expiresAt === null || link.expiresAt > now)
          return (
            <li key={link.id} data-active={active ? '' : undefined}>
              <div>
                <strong>{link.label || t('Untitled link')}</strong>
                <span className="analytik-muted">
                  {link.views.length ? link.views.map((v) => t(VIEW_LABELS[v])).join(', ') : t('All views')}
                  {' · '}
                  {t('Created {date}', { date: formatDateTime(link.createdAt, site.timezone) })}
                  {' · '}
                  {status(link, now)}
                </span>
              </div>
              {link.revokedAt === null && (
                <ConfirmButton
                  label={t('Revoke')}
                  title={t('Revoke this link?')}
                  description={t('Anyone who has the link loses access right away. This cannot be undone.')}
                  confirmLabel={t('Revoke link')}
                  onConfirm={() => run(client.revokeShareLink(site.id, link.id).then(onChange), t('Link revoked'))}
                />
              )}
            </li>
          )
        })}
      </ul>
      <Actions outcome={outcome}>{null}</Actions>
    </>
  )
}

/** Read-only links to the site's dashboard for people without an account. */
export function SharingSettings() {
  const { client, site } = useDashboard()
  const links = useResource<ShareLink[]>(`share-links:${site.id}`, () => client.shareLinks(site.id))
  return (
    <>
      <Card
        title={t('Share this dashboard')}
        description={t(
          'Make a link that shows this site read-only to anyone who has it: no sign-in, no settings, no other sites. The page that opens it must show the analytik dashboard.',
        )}
      >
        <NewLink onCreated={links.reload} />
      </Card>
      <Card title={t('Share links')}>
        <Status loading={links.loading && !links.data} error={links.error}>
          {links.data && <LinkList links={links.data} onChange={links.reload} />}
        </Status>
      </Card>
    </>
  )
}
