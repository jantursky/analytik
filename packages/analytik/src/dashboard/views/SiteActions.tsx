import { type ReactNode, type SubmitEvent, useState } from 'react'

import type { Site } from '../../shared/types'
import type { ApiClient } from '../api'
import { useDashboard } from '../context'
import { useResource } from '../data'
import { t } from '../i18n'
import { Icon } from '../icons'
import { Actions, Card, ErrorNote, useOutcome } from '../ui'
import { Dialog } from '../ui/dialog'

const MARK = '\u0000'

/** Fills the one marker of a translated sentence with bold text, wherever the language puts it. */
const rich = (text: string, bold: string): ReactNode => {
  const [before = '', after = ''] = text.split(MARK)
  return (
    <>
      {before}
      <strong>{bold}</strong>
      {after}
    </>
  )
}

/**
 * Asks for the admin password before deleting a site and everything recorded for it. When admins sign in through
 * the server's `verify()` option there is no password, so the site's domain is typed out instead.
 */
export function DeleteSiteDialog({
  client,
  site,
  open,
  onOpenChange,
  onDeleted,
}: {
  client: ApiClient
  site: Site
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeleted: () => void
}) {
  const auth = useResource(`auth-me-${String(open)}`, () => (open ? client.me() : Promise.resolve(null)))
  // Admins signing in through verify() have no password here; the typed domain is the proof then.
  const withPassword = auth.data?.login !== 'custom'
  const [domain, setDomain] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const change = (next: boolean): void => {
    if (!next) {
      setDomain('')
      setPassword('')
      setError(null)
    }
    onOpenChange(next)
  }
  const domainTyped = domain.trim().toLowerCase() === site.domain
  const ready = domainTyped && (!withPassword || password !== '')
  const submit = (event: SubmitEvent): void => {
    event.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    client.deleteSite(site.id, withPassword ? { confirm: site.domain, password } : { confirm: site.domain }).then(
      () => {
        setBusy(false)
        change(false)
        onDeleted()
      },
      (failure: unknown) => {
        setBusy(false)
        setError(failure instanceof Error ? failure.message : String(failure))
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={change} title={t('Delete {name}?', { name: site.name })}>
      <form className="analytik-form" onSubmit={submit}>
        <p className="analytik-dialog-text">
          {rich(
            t(
              'Everything recorded for {domain} is removed for good: visitors, visits, events, payments and funnels. The tracking snippet on the site stops working. This cannot be undone.',
              { domain: MARK },
            ),
            site.domain,
          )}
        </p>
        <label className="analytik-field">
          <span className="analytik-field-label">
            {rich(t('Type {domain} to confirm', { domain: MARK }), site.domain)}
          </span>
          <input
            className="analytik-input"
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={site.domain}
            value={domain}
            aria-invalid={domain && !domainTyped ? true : undefined}
            onChange={(e) => setDomain(e.target.value)}
          />
        </label>
        {withPassword && (
          <label className="analytik-field">
            <span className="analytik-field-label">{t('Admin password')}</span>
            <input
              className="analytik-input"
              type="password"
              autoComplete="current-password"
              value={password}
              aria-invalid={error ? true : undefined}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        )}
        {error && <ErrorNote title={t("Couldn't delete the website")}>{error}</ErrorNote>}
        <div className="analytik-actions analytik-card-actions">
          <button type="button" className="analytik-button" onClick={() => change(false)}>
            {t('Cancel')}
          </button>
          <button
            type="submit"
            className="analytik-button"
            data-variant="danger-solid"
            disabled={!ready || busy}
            aria-busy={busy || undefined}
          >
            <Icon name="trash" />
            {busy ? t('Deleting…') : t('Delete website')}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

/** Pauses or resumes tracking for `site`; resolves to the saved site. */
export const togglePaused = (client: ApiClient, site: Site): Promise<Site> =>
  client.updateSite(site.id, { paused: !site.paused })

/** Tracking on or paused, and deleting the site; at the end of the general settings. */
export function SiteLifecycle() {
  const { client, site, onSiteChange, openView } = useDashboard()
  const [outcome, run] = useOutcome()
  const [deleting, setDeleting] = useState(false)
  return (
    <>
      <Card
        title={t('Tracking')}
        description={t(
          'Pausing drops new visits, events and goals until you resume. Payments are still recorded, and nothing stored so far changes.',
        )}
      >
        <p className="analytik-tracking-state" data-paused={site.paused ? '' : undefined}>
          <span className="analytik-live-dot" data-idle={site.paused ? '' : undefined} aria-hidden="true" />
          {site.paused ? t('Tracking is paused') : t('Tracking is on')}
        </p>
        <Actions outcome={outcome}>
          <button
            type="button"
            className="analytik-button"
            data-variant={site.paused ? 'primary' : 'warning'}
            onClick={() =>
              run(
                togglePaused(client, site).then(onSiteChange),
                site.paused ? t('Tracking resumed') : t('Tracking paused'),
              )
            }
          >
            <Icon name={site.paused ? 'play' : 'pause'} />
            {site.paused ? t('Resume tracking') : t('Pause tracking')}
          </button>
        </Actions>
      </Card>
      <Card
        title={t('Delete this website')}
        description={t(
          "Removes the site with everything recorded for it. You'll be asked to type its domain and the admin password.",
        )}
      >
        <Actions>
          <button type="button" className="analytik-button" data-variant="danger" onClick={() => setDeleting(true)}>
            <Icon name="trash" />
            {t('Delete website')}
          </button>
        </Actions>
        <DeleteSiteDialog
          client={client}
          site={site}
          open={deleting}
          onOpenChange={setDeleting}
          onDeleted={() => {
            onSiteChange(site)
            openView?.('sites')
          }}
        />
      </Card>
    </>
  )
}
