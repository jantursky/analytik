import { useState } from 'react'

import type { SyncChange, SyncField, SyncPreview } from '../../shared/types'
import { useDashboard } from '../context'
import { t } from '../i18n'
import { Icon } from '../icons'
import { Actions, Card, type Outcome } from '../ui'

const SYNC_ORDER: SyncField[] = ['name', 'color', 'icon']

const LABELS: Record<SyncField, () => string> = {
  name: () => t('Name'),
  color: () => t('Colour'),
  icon: () => t('Icon'),
}

/** The stored value or the page's, in the way that suits the detail: a swatch for a colour, the picture for an icon. */
function Value({ change, side, src }: { change: SyncChange; side: 'current' | 'found'; src?: string }) {
  const value = change[side]
  if (change.field === 'icon') {
    const shown = side === 'found' ? value : src
    return shown ? <img className="analytik-sync-icon" src={shown} alt="" /> : <span className="analytik-muted">–</span>
  }
  if (value === null) return <span className="analytik-muted">–</span>
  return change.field === 'color' ? (
    <span className="analytik-sync-color">
      <span className="analytik-sync-swatch" style={{ background: value }} aria-hidden="true" />
      {value}
    </span>
  ) : (
    <span>{value}</span>
  )
}

/**
 * Reads the site's own page and offers its name, icon and colour. The admin ticks what to take; a name typed by hand
 * starts unticked.
 */
export function SiteSync() {
  const { client, apiUrl, site, onSiteChange } = useDashboard()
  const [preview, setPreview] = useState<SyncPreview>()
  const [chosen, setChosen] = useState<SyncField[]>([])
  const [busy, setBusy] = useState<'check' | 'apply'>()
  const [outcome, setOutcome] = useState<Outcome>()
  const fail = (error: unknown): void =>
    setOutcome({ ok: false, text: error instanceof Error ? error.message : String(error) })

  const check = (): void => {
    setBusy('check')
    setOutcome(undefined)
    setPreview(undefined)
    client
      .previewSync(site.id)
      .then((found) => {
        setPreview(found)
        setChosen(found.changes.filter((c) => c.changed && !c.manual).map((c) => c.field))
      }, fail)
      .finally(() => setBusy(undefined))
  }

  const apply = (): void => {
    setBusy('apply')
    setOutcome(undefined)
    client
      .applySync(
        site.id,
        SYNC_ORDER.filter((field) => chosen.includes(field)),
      )
      .then(({ site: next }) => {
        onSiteChange(next)
        setPreview(undefined)
        setOutcome({ ok: true, text: t('Website details applied') })
      }, fail)
      .finally(() => setBusy(undefined))
  }

  const toggle = (field: SyncField): void =>
    setChosen((now) => (now.includes(field) ? now.filter((f) => f !== field) : [...now, field]))

  const changed = preview?.changes.filter((c) => c.changed) ?? []
  const unchanged = preview?.changes.filter((c) => !c.changed) ?? []
  return (
    <Card
      title={t('Sync from website')}
      description={t(
        'Reads the site’s own page and offers its name, icon and colour. Nothing changes until you choose.',
      )}
    >
      {preview?.skipped && <p className="analytik-muted">{t('A generated test site has no website to read.')}</p>}
      {preview && !preview.skipped && !preview.reachable && (
        <p className="analytik-muted">{t('The website could not be read.')}</p>
      )}
      {preview?.reachable && (
        <>
          {changed.length > 0 ? (
            <ul className="analytik-sync-list" aria-label={t('Details to take over')}>
              {changed.map((change) => (
                <li key={change.field}>
                  <label className="analytik-check">
                    <input
                      type="checkbox"
                      checked={chosen.includes(change.field)}
                      onChange={() => toggle(change.field)}
                    />
                    <span className="analytik-sync-field">{LABELS[change.field]()}</span>
                  </label>
                  <span className="analytik-sync-values">
                    <Value
                      change={change}
                      side="current"
                      src={change.current ? `${apiUrl}/sites/${site.id}/favicon?v=${change.current}` : undefined}
                    />
                    <Icon name="arrow" />
                    <Value change={change} side="found" />
                  </span>
                  {change.manual && <span className="analytik-badge">{t('Set by hand')}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="analytik-muted">{t('The website already matches.')}</p>
          )}
          {unchanged.length > 0 && changed.length > 0 && (
            <p className="analytik-muted">
              {t('Already up to date: {fields}', { fields: unchanged.map((c) => LABELS[c.field]()).join(', ') })}
            </p>
          )}
          {preview.tracker !== 'unknown' && (
            <p className="analytik-muted">
              {preview.tracker === 'found'
                ? t('The tracker is on the page.')
                : t('The tracker was not found on the page. A script manager may add it later.')}
            </p>
          )}
        </>
      )}
      <Actions outcome={outcome}>
        <button
          type="button"
          className="analytik-button"
          aria-busy={busy === 'check'}
          disabled={busy !== undefined}
          onClick={check}
        >
          <span className="analytik-button-icon" data-busy={busy === 'check' ? '' : undefined}>
            <Icon name="refresh" />
          </span>
          {preview ? t('Check again') : t('Check website')}
        </button>
        {changed.length > 0 && (
          <button
            type="button"
            className="analytik-button"
            data-variant="primary"
            aria-busy={busy === 'apply'}
            disabled={busy !== undefined || chosen.length === 0}
            onClick={apply}
          >
            {t('Apply selected')}
          </button>
        )}
      </Actions>
    </Card>
  )
}
