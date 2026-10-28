import { Fragment, type ReactNode } from 'react'

import { useDashboard } from '../context'
import { useResource } from '../data'
import { t } from '../i18n'
import { Card } from '../ui'

interface Release {
  version: string
  groups: { title: string; items: string[] }[]
}

/** Reads the Keep a Changelog file: `## [version]`, then `### Group` headings, then `- item` bullets that may wrap. */
export function parseChangelog(source: string): Release[] {
  const releases: Release[] = []
  for (const line of source.split('\n')) {
    const release = /^## \[(.+?)\]/.exec(line)
    if (release?.[1]) {
      releases.push({ version: release[1], groups: [] })
      continue
    }
    const current = releases.at(-1)
    if (!current) continue
    const group = /^### (.+)/.exec(line)
    if (group?.[1]) {
      current.groups.push({ title: group[1].trim(), items: [] })
      continue
    }
    const items = current.groups.at(-1)?.items
    if (!items) continue
    if (line.startsWith('- ')) items.push(line.slice(2).trim())
    else if (line.startsWith('  ') && items.length > 0) items.push(`${items.pop() ?? ''} ${line.trim()}`)
  }
  return releases.filter((r) => r.groups.some((g) => g.items.length > 0))
}

/** Backticked words as code, everything else as plain text. */
function inline(text: string): ReactNode {
  return text
    .split(/(`[^`]+`)/)
    .map((part, i) =>
      part.startsWith('`') && part.endsWith('`') && part.length > 2 ? (
        <code key={i}>{part.slice(1, -1)}</code>
      ) : (
        <Fragment key={i}>{part}</Fragment>
      ),
    )
}

/** What changed in each release. The file is bundled with the dashboard but loaded only when this section opens. */
export function Changelog() {
  const { client } = useDashboard()
  const running = useResource('version', () => client.version().catch(() => null)).data?.current
  const releases = useResource('changelog', async () =>
    parseChangelog((await import('../../../CHANGELOG.md?raw')).default),
  )
  if (releases.loading) return <Card title={t('Changelog')}>{t('Loading…')}</Card>
  if (!releases.data?.length) return <Card title={t('Changelog')}>{t('No release notes found.')}</Card>
  return (
    <>
      {releases.data.map(({ version, groups }) => (
        <Card
          key={version}
          title={version === 'Unreleased' ? t('Unreleased') : version}
          description={version === running ? t('The version you are running.') : undefined}
        >
          <div className="analytik-changelog">
            {groups.map(({ title, items }) => (
              <div key={title}>
                <h3>{title}</h3>
                <ul>
                  {items.map((item) => (
                    <li key={item}>{inline(item)}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </>
  )
}
