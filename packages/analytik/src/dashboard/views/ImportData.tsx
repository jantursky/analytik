import { type ChangeEvent, useRef, useState } from 'react'

import type { PreparedImport } from '../../shared/import/prepare'
import type { ImportResult, ImportSource, ImportSummary } from '../../shared/import/types'
import { useDashboard } from '../context'
import { useResource } from '../data'
import { formatDate, formatDateTime, formatNumber } from '../format'
import { t } from '../i18n'
import { Actions, Card, ConfirmButton, ErrorNote, Field, useOutcome } from '../ui'
import { Select } from '../ui/select'

export const SOURCES: { value: ImportSource; label: string }[] = [
  { value: 'umami', label: 'Umami' },
  { value: 'simple-analytics', label: 'Simple Analytics' },
]

const sourceLabel = (source: ImportSource): string => SOURCES.find((s) => s.value === source)?.label ?? source

type Stage =
  | { name: 'idle' }
  | { name: 'reading' }
  | { name: 'preview'; prepared: PreparedImport; existing: number | null }
  | { name: 'running'; done: number; total: number }
  | {
      name: 'finished'
      result: ImportResult
      skipped: PreparedImport['skipped']
      stopped: { done: number; total: number } | null
    }

export const PREVIEW_ROWS = 5
const SKIPPED_SHOWN = 10

export function startOf(prepared: PreparedImport): { from: number; to: number } {
  const times = prepared.visits.map((visit) => visit.startedAt ?? Math.min(...visit.events.map((event) => event.ts)))
  return { from: Math.min(...times), to: Math.max(...times) }
}

export function Preview({
  prepared,
  existing,
  timezone,
  rows = PREVIEW_ROWS,
}: {
  prepared: PreparedImport
  existing: number | null
  timezone: string
  rows?: number
}) {
  const { from, to } = startOf(prepared)
  const events = prepared.visits.reduce((sum, visit) => sum + visit.events.length, 0)
  return (
    <>
      <dl className="analytik-import-stats">
        <div>
          <dt>{t('Visits')}</dt>
          <dd>{formatNumber(prepared.visits.length)}</dd>
        </div>
        <div>
          <dt>{t('Events')}</dt>
          <dd>{formatNumber(events)}</dd>
        </div>
        <div>
          <dt>{t('First visit')}</dt>
          <dd>{formatDate(from, timezone)}</dd>
        </div>
        <div>
          <dt>{t('Last visit')}</dt>
          <dd>{formatDate(to, timezone)}</dd>
        </div>
        <div>
          <dt>{t('Skipped rows')}</dt>
          <dd>{formatNumber(prepared.skipped.length)}</dd>
        </div>
      </dl>
      {existing ? (
        <p className="analytik-import-note">
          {t(
            'The site already has {count, plural, one {# visit} other {# visits}} in these dates. The imported ones are added next to them.',
            { count: existing },
          )}
        </p>
      ) : null}
      <div className="analytik-table-wrap">
        <table className="analytik-table">
          <thead>
            <tr>
              <th>{t('Time')}</th>
              <th>{t('Entry page')}</th>
              <th>{t('Country')}</th>
              <th>{t('Browser')}</th>
              <th className="analytik-num">{t('Pageviews')}</th>
            </tr>
          </thead>
          <tbody>
            {prepared.visits.slice(0, rows).map((visit) => (
              <tr key={visit.id}>
                <td>{formatDateTime(visit.startedAt ?? visit.events[0]?.ts ?? 0, timezone)}</td>
                <td className="analytik-mono">{visit.events[0]?.path ?? '—'}</td>
                <td>{visit.country ?? '—'}</td>
                <td>{visit.browser ?? '—'}</td>
                <td className="analytik-num">{visit.events.filter((event) => event.type === 'pageview').length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

export function Result({
  result,
  skipped,
  stopped,
}: {
  result: ImportResult
  skipped: PreparedImport['skipped']
  stopped: { done: number; total: number } | null
}) {
  return (
    <>
      {stopped && (
        <p className="analytik-import-note" role="status">
          {t(
            'Stopped after {done} of {total} visits. Choose the same files again to finish; what is stored is not added twice.',
            {
              done: formatNumber(stopped.done),
              total: formatNumber(stopped.total),
            },
          )}
        </p>
      )}
      <div className="analytik-table-wrap">
        <table className="analytik-table">
          <thead>
            <tr>
              <th />
              <th className="analytik-num">{t('Visits')}</th>
              <th className="analytik-num">{t('Events')}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">{t('Imported')}</th>
              <td className="analytik-num">{formatNumber(result.visits)}</td>
              <td className="analytik-num">{formatNumber(result.events)}</td>
            </tr>
            <tr>
              <th scope="row">{t('Already imported')}</th>
              <td className="analytik-num">{formatNumber(result.existing.visits)}</td>
              <td className="analytik-num">{formatNumber(result.existing.events)}</td>
            </tr>
            <tr>
              <th scope="row">{t('Older than the retention limit')}</th>
              <td className="analytik-num">{formatNumber(result.tooOld.visits)}</td>
              <td className="analytik-num">{formatNumber(result.tooOld.events)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {skipped.length > 0 && (
        <>
          <p className="analytik-field-label">
            {t('Skipped rows')}: {formatNumber(skipped.length)}
          </p>
          <ul className="analytik-import-skipped">
            {skipped.slice(0, SKIPPED_SHOWN).map((row, index) => (
              <li key={index} className="analytik-muted">
                {t('Row {row}: {reason}', { row: row.row, reason: row.reason })}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}

/** Imports the history of another analytics tool into the site: choose, preview, import in chunks, see the result. */
export function ImportData({ onImported }: { onImported: () => void }) {
  const { client, site } = useDashboard()
  const [source, setSource] = useState<ImportSource>('umami')
  const [stage, setStage] = useState<Stage>({ name: 'idle' })
  const [error, setError] = useState<string>()
  const [files, setFiles] = useState<File[]>([])
  const stop = useRef(false)
  // Read through a function: the flag is set by a click while the loop awaits, which flow analysis cannot see.
  const cancelled = (): boolean => stop.current

  const reset = (): void => {
    setStage({ name: 'idle' })
    setError(undefined)
    setFiles([])
  }

  const choose = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const chosen = Array.from(event.target.files ?? [])
    setFiles(chosen)
    setError(undefined)
    if (chosen.length === 0) {
      setStage({ name: 'idle' })
      return
    }
    setStage({ name: 'reading' })
    try {
      const { readBrowserFile, prepareImport } = await import('../import-files')
      const prepared = prepareImport(source, await Promise.all(chosen.map(readBrowserFile)))
      if (prepared.visits.length === 0) throw new Error(t('No visits found in these files.'))
      const { from, to } = startOf(prepared)
      // Visits the site already holds in these dates, tracked or imported earlier, so overlap is not a surprise.
      const existing = await client
        .sessions(site.id, { from, to: to + 1, interval: 'day', tz: site.timezone, limit: 1 })
        .then((page) => page.total)
        .catch(() => null)
      setStage({ name: 'preview', prepared, existing })
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem))
      setStage({ name: 'idle' })
    }
  }

  const run = async (prepared: PreparedImport): Promise<void> => {
    const { importChunks } = await import('../import-files')
    const total = prepared.visits.length
    stop.current = false
    setStage({ name: 'running', done: 0, total })
    const {
      result,
      done,
      error: failed,
    } = await importChunks(client, site.id, source, prepared, {
      onProgress: (sent) => setStage({ name: 'running', done: sent, total }),
      cancelled,
    })
    if (failed) setError(failed)
    setStage({
      name: 'finished',
      result,
      skipped: prepared.skipped,
      stopped: done < total ? { done, total } : null,
    })
    onImported()
  }

  const hint =
    source === 'umami'
      ? t('The website_event export, plus the session and event_data exports if you have them.')
      : t('The CSV from the raw data export, with pages and events together.')

  return (
    <Card
      title={t('Import data')}
      description={t(
        'Add the history of another analytics tool to this site. Imported visits are kept apart from the ones this site tracked.',
      )}
    >
      {(stage.name === 'idle' || stage.name === 'reading') && (
        <div className="analytik-row">
          <Select
            label={t('Import from')}
            value={source}
            options={SOURCES}
            onChange={(next) => {
              setSource(next)
              reset()
            }}
          />
          <Field label={t('Export files')} hint={hint}>
            <input
              key={`${source}-${files.length}`}
              className="analytik-input"
              type="file"
              accept=".csv,.json,text/csv,application/json"
              multiple
              disabled={stage.name === 'reading'}
              onChange={(event) => void choose(event)}
            />
          </Field>
        </div>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      {stage.name === 'preview' && (
        <>
          <Preview prepared={stage.prepared} existing={stage.existing} timezone={site.timezone} />
          <Actions>
            <button type="button" className="analytik-button" onClick={reset}>
              {t('Cancel')}
            </button>
            <button
              type="button"
              className="analytik-button"
              data-variant="primary"
              onClick={() => void run(stage.prepared)}
            >
              {t('Import {count, plural, one {# visit} other {# visits}}', { count: stage.prepared.visits.length })}
            </button>
          </Actions>
        </>
      )}
      {stage.name === 'running' && (
        <>
          <progress className="analytik-import-progress" max={stage.total} value={stage.done} />
          <p role="status" className="analytik-muted">
            {t('Importing {done} of {total} visits', {
              done: formatNumber(stage.done),
              total: formatNumber(stage.total),
            })}
          </p>
          <Actions>
            <button type="button" className="analytik-button" onClick={() => (stop.current = true)}>
              {t('Cancel')}
            </button>
          </Actions>
        </>
      )}
      {stage.name === 'finished' && (
        <>
          <Result result={stage.result} skipped={stage.skipped} stopped={stage.stopped} />
          <Actions>
            <button type="button" className="analytik-button" data-variant="primary" onClick={reset}>
              {t('Done')}
            </button>
          </Actions>
        </>
      )}
    </Card>
  )
}

/** What each tool added to the site, with a way to remove it. Shows nothing until something was imported. */
export function ImportedData() {
  const { client, site } = useDashboard()
  const list = useResource(`imports:${site.id}`, () => client.imports(site.id))
  const [outcome, run] = useOutcome()
  return (
    <>
      <ImportData onImported={list.reload} />
      {list.data && list.data.length > 0 && (
        <Card
          title={t('Imported data')}
          description={t(
            'What each tool added to this site. Removing an import deletes its visits and events and leaves everything the tracker recorded.',
          )}
        >
          <ul className="analytik-import-list">
            {list.data.map((item: ImportSummary) => (
              <li key={item.source}>
                <div>
                  <strong>{sourceLabel(item.source)}</strong>
                  <span className="analytik-muted">
                    {formatNumber(item.visits)} {t('Visits')} · {formatNumber(item.events)} {t('Events')} ·{' '}
                    {formatDate(item.from, site.timezone)} – {formatDate(item.to, site.timezone)}
                  </span>
                </div>
                <ConfirmButton
                  label={t('Remove')}
                  title={t('Remove the {source} import?', { source: sourceLabel(item.source) })}
                  description={t(
                    'This deletes {visits, plural, one {# visit} other {# visits}} and {events, plural, one {# event} other {# events}} imported from {source}. What the tracker recorded is not touched.',
                    { visits: item.visits, events: item.events, source: sourceLabel(item.source) },
                  )}
                  confirmLabel={t('Remove import')}
                  onConfirm={() =>
                    run(
                      client.removeImport(site.id, item.source).then((removed) => {
                        list.reload()
                        return removed
                      }),
                      t('Import removed'),
                    )
                  }
                />
              </li>
            ))}
          </ul>
          <Actions outcome={outcome}>{null}</Actions>
        </Card>
      )}
    </>
  )
}
