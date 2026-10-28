import { isNewer } from '../shared/semver'
import type { ApiClient } from './api'
import { useResource } from './data'
import { Icon } from './icons'
import { t } from './i18n'
import { usePreferences } from './preferences'

const RELEASES = 'https://github.com/jantursky/analytik/releases/tag'
const GUIDE = 'https://analytik-docs.vercel.app/deploy/backups-retention-and-upgrades#updating'

/**
 * A bar above the dashboard when a newer Analytik release is out. A small dot beats to draw the eye; closing the bar
 * remembers that version (saved with the other settings), so it comes back only for the next release.
 */
export function UpdateNotice({ client }: { client: ApiClient }) {
  const { values, update } = usePreferences()
  const version = useResource('version', () => client.version().catch(() => null))
  const latest = version.data?.latest
  if (!latest || !version.data || !isNewer(latest, version.data.current) || values.updateDismissed === latest)
    return null
  return (
    <div className="analytik-update" role="status">
      <span className="analytik-update-dot" aria-hidden="true" />
      <p>
        <strong>{t('Analytik {latest} is available.', { latest })}</strong>{' '}
        {t('You are running {current}.', { current: version.data.current })}
      </p>
      <a className="analytik-link" href={`${RELEASES}/${latest}`} target="_blank" rel="noopener">
        {t("What's new")}
      </a>
      <a className="analytik-link" href={GUIDE} target="_blank" rel="noopener">
        {t('How to update')}
      </a>
      <button
        type="button"
        className="analytik-pill-icon"
        aria-label={t('Dismiss the update notice for {latest}', { latest })}
        onClick={() => update({ updateDismissed: latest })}
      >
        <Icon name="close" />
      </button>
    </div>
  )
}
