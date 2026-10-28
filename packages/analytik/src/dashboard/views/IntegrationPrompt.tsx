import { useEffect, useState } from 'react'

import { useDashboard } from '../context'
import { t } from '../i18n'
import { Actions, Card, CopyButton } from '../ui'
import { Select } from '../ui/select'
import type { SiteTarget } from '../site-prompt'

const load = () => import('../site-prompt')

/**
 * A prompt for a coding assistant that adds the tracker to the site, in the right file for its framework. The
 * framework guides are loaded when the card opens, so they stay out of the dashboard's first load.
 */
export function IntegrationPrompt() {
  const { site, apiUrl } = useDashboard()
  const [target, setTarget] = useState<SiteTarget>('html')
  const [module, setModule] = useState<Awaited<ReturnType<typeof load>>>()
  useEffect(() => {
    let current = true
    void load().then((loaded) => current && setModule(loaded))
    return () => {
      current = false
    }
  }, [])

  const options = module?.SITE_TARGETS
  const prompt = module?.sitePrompt(target, {
    host: new URL(apiUrl).origin,
    siteId: site.id,
    mode: site.privacyMode,
    requireInteraction: true,
    allowLocalhost: site.allowLocalhost,
    autoOutbound: true,
  })
  return (
    <Card
      title={t('Site integration prompt')}
      description={t('Let your coding assistant add the tracker to your site, in the right file for your framework.')}
    >
      {options && prompt !== undefined ? (
        <>
          <Select
            label={t('Framework or platform')}
            value={target}
            options={options.map(({ id, label }) => ({ value: id, label }))}
            onChange={setTarget}
          />
          <pre className="analytik-code analytik-prompt-preview" tabIndex={0} aria-label={t('Prompt')}>
            <code>{prompt}</code>
          </pre>
          <Actions>
            <span className="analytik-field-hint">
              {t('{count, plural, one {# character} other {# characters}}', { count: prompt.length })}
            </span>
            <CopyButton text={prompt} label={t('Copy prompt')} />
          </Actions>
        </>
      ) : (
        <p className="analytik-muted">{t('Loading…')}</p>
      )}
    </Card>
  )
}
