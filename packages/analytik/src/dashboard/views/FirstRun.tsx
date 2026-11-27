import { useDashboard } from '../context'
import { t } from '../i18n'
import { buildSnippet } from '../snippet'
import { Actions, Card, CopyButton } from '../ui'

/**
 * Shown on the overview of a site that has never received an event: the tracking code to paste, and a way to the
 * prompt that lets a coding assistant add it.
 */
export function FirstRun() {
  const { site, apiUrl, openView } = useDashboard()
  const snippet = buildSnippet({
    site: site.id,
    apiUrl,
    mode: site.privacyMode,
    requireInteraction: true,
    autoOutbound: true,
    keepQuery: '',
    vitals: site.vitalsSample,
    debug: false,
  })
  return (
    <Card
      title={t('No data yet')}
      description={t(
        'Nothing has been tracked for this site yet. Paste this into the head of every page, and the overview fills in with the first visit.',
      )}
    >
      <pre className="analytik-code" aria-label={t('Snippet')}>
        <code>{snippet}</code>
      </pre>
      <Actions>
        <CopyButton text={snippet} label={t('Copy snippet')} />
        {openView && (
          <button type="button" className="analytik-link" onClick={() => openView('settings', 'tracking')}>
            {t('Let your coding assistant add it')}
          </button>
        )}
      </Actions>
    </Card>
  )
}
