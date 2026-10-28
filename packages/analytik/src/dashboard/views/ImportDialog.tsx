import { type DragEvent, type ReactNode, useEffect, useRef, useState } from 'react'

import type { PreparedImport } from '../../shared/import/prepare'
import type { ImportResult, ImportSource } from '../../shared/import/types'
import { cleanDomain, domainProblem } from '../../shared/url'
import type { Site } from '../../shared/types'
import type { ApiClient } from '../api'
import { formatNumber } from '../format'
import { t } from '../i18n'
import { DomainField, nameFromDomain } from '../Login'
import { Icon } from '../icons'
import { Actions, ErrorNote } from '../ui'
import { Dialog } from '../ui/dialog'
import { Select } from '../ui/select'
import { localTimeZone } from '../ui/timezone'
import { Preview, Result, SOURCES, startOf } from './ImportData'

const NEW_SITE = 'new'
const PREVIEW_ROWS = 8

const HINTS: Record<ImportSource, () => string> = {
  umami: () =>
    t('Drop the website_event export, and the session and event_data exports if you have them (CSV or JSON).'),
  'simple-analytics': () => t('Drop the CSV from the raw data export, with pages and events together.'),
}

/** A tile with the platform's initial in its colour; a mark of our own, not the platform's logo. */
function SourceMark({ source }: { source: ImportSource }) {
  return (
    <span className="analytik-source-mark" data-source={source} aria-hidden="true">
      {source === 'umami' ? (
        <svg viewBox="0 0 32 32" width="28" height="28">
          <path
            d="M8 7v10a8 8 0 0 0 16 0V7"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.2"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 32 32" width="28" height="28">
          <path
            d="M6 22c3-9 6-9 10-4s7 4 10-8"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  )
}

function DropZone({ hint, busy, onFiles }: { hint: string; busy: boolean; onFiles: (files: File[]) => void }) {
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const drop = (event: DragEvent): void => {
    event.preventDefault()
    setOver(false)
    const files = Array.from(event.dataTransfer.files)
    if (files.length > 0) onFiles(files)
  }
  return (
    <div
      className="analytik-dropzone"
      data-over={over || undefined}
      onDragOver={(event) => {
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      <Icon name="upload" />
      <p>
        <strong>{t('Drop the export files here')}</strong>
      </p>
      <p className="analytik-muted">{hint}</p>
      <button
        type="button"
        className="analytik-button"
        disabled={busy}
        aria-busy={busy || undefined}
        onClick={() => input.current?.click()}
      >
        {busy ? t('Reading…') : t('Choose files')}
      </button>
      <input
        ref={input}
        hidden
        type="file"
        multiple
        accept=".csv,.json,text/csv,application/json"
        aria-label={t('Export files')}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          if (files.length > 0) onFiles(files)
        }}
      />
    </div>
  )
}

type Stage =
  | { name: 'source' }
  | { name: 'files'; source: ImportSource; reading: boolean }
  | { name: 'preview'; source: ImportSource; prepared: PreparedImport; files: string[] }
  | { name: 'running'; source: ImportSource; done: number; total: number }
  | {
      name: 'finished'
      site: Site
      result: ImportResult
      skipped: PreparedImport['skipped']
      stopped: { done: number; total: number } | null
    }

/** The most common hostname in the visits, without `www.`, as a start for the new site's domain. */
function likelyDomain(prepared: PreparedImport): string {
  const counts = new Map<string, number>()
  for (const visit of prepared.visits) {
    const host = visit.hostname?.toLowerCase().replace(/^www\./, '')
    if (host) counts.set(host, (counts.get(host) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
}

export interface ImportDialogProps {
  client: ApiClient
  sites: Site[]
  open: boolean
  onClose: () => void
  /** Called once an import ran, so the list of sites can reload (a site may have been created). */
  onImported: () => void
  /** Called by "Open site" after an import. */
  onOpen: (site: Site) => void
}

/**
 * Brings the history of another analytics tool into a site: pick the platform, drop its export files, check what was
 * found in a table, choose the site (or a new one), confirm, and see what was stored.
 */
export function ImportDialog({ client, sites, open, onClose, onImported, onOpen }: ImportDialogProps) {
  const [stage, setStage] = useState<Stage>({ name: 'source' })
  const [error, setError] = useState<string>()
  const [target, setTarget] = useState(NEW_SITE)
  const [domain, setDomain] = useState('')
  const [touched, setTouched] = useState(false)
  const [found, setFound] = useState<{ key: string; count: number }>()
  const stop = useRef(false)
  const cancelled = (): boolean => stop.current

  const target_ = sites.find((site) => site.id === target)
  const preparedNow = stage.name === 'preview' ? stage.prepared : null

  // Visits the chosen site already holds in the file's dates, so an overlap is no surprise.
  const overlapKey = preparedNow && target_ ? `${target_.id}:${preparedNow.visits.length}` : null
  useEffect(() => {
    if (!preparedNow || !target_ || !overlapKey) return
    let live = true
    const { from, to } = startOf(preparedNow)
    client
      .sessions(target_.id, { from, to: to + 1, interval: 'day', tz: target_.timezone, limit: 1 })
      .then((page) => live && setFound({ key: overlapKey, count: page.total }))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [client, preparedNow, target_, overlapKey])
  const existing = found?.key === overlapKey ? found.count : null

  const close = (): void => {
    stop.current = true
    onClose()
  }
  const restart = (): void => {
    setStage({ name: 'source' })
    setError(undefined)
  }

  const read = async (source: ImportSource, files: File[]): Promise<void> => {
    setError(undefined)
    setStage({ name: 'files', source, reading: true })
    try {
      const { readBrowserFile, prepareImport } = await import('../import-files')
      const prepared = prepareImport(source, await Promise.all(files.map(readBrowserFile)))
      if (prepared.visits.length === 0) throw new Error(t('No visits found in these files.'))
      setDomain(likelyDomain(prepared))
      setTouched(false)
      setTarget(NEW_SITE)
      setStage({ name: 'preview', source, prepared, files: files.map((file) => file.name) })
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem))
      setStage({ name: 'files', source, reading: false })
    }
  }

  const run = async (source: ImportSource, prepared: PreparedImport): Promise<void> => {
    let site = target_
    setError(undefined)
    if (!site) {
      setTouched(true)
      if (domainProblem(domain)) return
      const clean = cleanDomain(domain)
      if (!clean) return
      const newest = sites.reduce<Site | undefined>((n, s) => (!n || s.createdAt > n.createdAt ? s : n), undefined)
      try {
        site = await client.createSite({
          name: nameFromDomain(clean) || clean,
          domain: clean,
          timezone: newest?.timezone ?? localTimeZone(),
          currency: newest?.currency ?? 'USD',
          retentionDays: newest?.retentionDays ?? null,
        })
      } catch (problem) {
        setError(problem instanceof Error ? problem.message : String(problem))
        return
      }
    }
    const total = prepared.visits.length
    stop.current = false
    setStage({ name: 'running', source, done: 0, total })
    const { importChunks } = await import('../import-files')
    const {
      result,
      done,
      error: failed,
    } = await importChunks(client, site.id, source, prepared, {
      onProgress: (sent) => setStage({ name: 'running', source, done: sent, total }),
      cancelled,
    })
    if (failed) setError(failed)
    setStage({
      name: 'finished',
      site,
      result,
      skipped: prepared.skipped,
      stopped: done < total ? { done, total } : null,
    })
    onImported()
  }

  const label = (source: ImportSource): string => SOURCES.find((s) => s.value === source)?.label ?? source

  let body: ReactNode
  if (stage.name === 'source') {
    body = (
      <>
        <p className="analytik-login-lede">{t('Which tool are you importing from?')}</p>
        <div className="analytik-choice-grid">
          {SOURCES.map((source) => (
            <button
              key={source.value}
              type="button"
              className="analytik-source-choice"
              onClick={() => setStage({ name: 'files', source: source.value, reading: false })}
            >
              <SourceMark source={source.value} />
              <strong>{source.label}</strong>
              <Icon name="next" />
            </button>
          ))}
        </div>
        <p className="analytik-field-hint">
          {t('Plausible and Google Analytics 4 cannot be imported: they do not export individual visits.')}
        </p>
      </>
    )
  } else if (stage.name === 'files') {
    body = (
      <>
        <div className="analytik-source-head">
          <SourceMark source={stage.source} />
          <strong>{label(stage.source)}</strong>
          <button type="button" className="analytik-button" onClick={restart}>
            {t('Change')}
          </button>
        </div>
        <DropZone
          hint={HINTS[stage.source]()}
          busy={stage.reading}
          onFiles={(files) => void read(stage.source, files)}
        />
        {error && <ErrorNote>{error}</ErrorNote>}
      </>
    )
  } else if (stage.name === 'preview') {
    const { prepared, source, files } = stage
    const events = prepared.visits.reduce((sum, visit) => sum + visit.events.length, 0)
    const chosen = target_
    body = (
      <>
        <div className="analytik-source-head">
          <SourceMark source={source} />
          <strong>{label(source)}</strong>
          <span className="analytik-muted">{files.join(', ')}</span>
        </div>
        <Preview
          prepared={prepared}
          existing={existing}
          timezone={chosen?.timezone ?? localTimeZone()}
          rows={PREVIEW_ROWS}
        />
        <Select
          label={t('Import into')}
          value={target}
          options={[
            { value: NEW_SITE, label: t('A new website') },
            ...sites.map((site) => ({ value: site.id, label: site.name, description: site.domain })),
          ]}
          onChange={(next) => setTarget(next)}
        />
        {!chosen && (
          <DomainField
            value={domain}
            onChange={setDomain}
            hint={t('Taken from the files; change it if it is not the site you are importing into.')}
            touched={touched}
            onBlur={() => setTouched(true)}
          />
        )}
        <p className="analytik-import-note" role="status">
          {t(
            'Import {visits, plural, one {# visit} other {# visits}} and {events, plural, one {# event} other {# events}} from {source} into {site}?',
            {
              visits: prepared.visits.length,
              events,
              source: label(source),
              site: chosen?.name ?? (domainProblem(domain) ? t('a new website') : (cleanDomain(domain) ?? domain)),
            },
          )}{' '}
          {t('They are kept apart from tracked visits, and you can remove the import later in Settings.')}
        </p>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Actions>
          <button type="button" className="analytik-button" onClick={restart}>
            {t('Back')}
          </button>
          <button
            type="button"
            className="analytik-button"
            data-variant="primary"
            onClick={() => void run(source, prepared)}
          >
            {t('Import {count, plural, one {# visit} other {# visits}}', { count: prepared.visits.length })}
          </button>
        </Actions>
      </>
    )
  } else if (stage.name === 'running') {
    body = (
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
    )
  } else {
    body = (
      <>
        {error && <ErrorNote>{error}</ErrorNote>}
        <p className="analytik-login-lede">{t('Imported into {site}.', { site: stage.site.name })}</p>
        <Result result={stage.result} skipped={stage.skipped} stopped={stage.stopped} />
        <Actions>
          <button type="button" className="analytik-button" onClick={close}>
            {t('Close')}
          </button>
          <button
            type="button"
            className="analytik-button"
            data-variant="primary"
            onClick={() => {
              onOpen(stage.site)
              close()
            }}
          >
            {t('Open site')}
          </button>
        </Actions>
      </>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()} title={t('Import from another tool')} size="wide">
      <div className="analytik-import-dialog">{body}</div>
    </Dialog>
  )
}
