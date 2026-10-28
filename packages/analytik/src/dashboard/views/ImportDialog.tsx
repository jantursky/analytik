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
  matomo: () => t('Drop the JSON from Live.getLastVisitsDetails (format=json).'),
  goatcounter: () => t('Drop the CSV from Settings, Export.'),
  ga4: () => t('Drop the JSON from the BigQuery export of the events tables.'),
  posthog: () => t('Drop the JSON from the events API or a batch export.'),
}

/**
 * The platforms' own marks (from the Simple Icons set; GoatCounter's from its site), shown only to tell the sources
 * apart. Each is drawn in the platform's colour on a white tile.
 */
const MARKS: Record<ImportSource, { viewBox: string; d: string[]; stroke?: number }> = {
  umami: {
    viewBox: '0 0 24 24',
    d: [
      'M2.203 8.611H.857a.845.845 0 0 0-.841.841v.858a13.31 13.31 0 0 0-.016.6c0 6.627 5.373 12 12 12 6.527 0 11.837-5.212 11.996-11.701 0-.025.004-.05.004-.075V9.452a.845.845 0 0 0-.841-.841h-1.346c-1.159-4.329-5.112-7.521-9.805-7.521-4.692 0-8.645 3.192-9.805 7.521Zm18.444 0H3.37c1.127-3.702 4.57-6.399 8.638-6.399 4.069 0 7.512 2.697 8.639 6.399Z',
    ],
  },
  'simple-analytics': {
    viewBox: '0 0 24 24',
    d: ['M1.019 13.019h3.849V24h-3.85zm8.943-6.68h3.85V24h-3.85zM19.132 0h3.85v24h-3.85z'],
  },
  matomo: {
    viewBox: '0 0 24 24',
    d: [
      'M6.664 15.37a3.336 3.336 0 0 1-3.332 3.332C1.495 18.702 0 17.208 0 15.37s1.495-3.333 3.332-3.333a3.338 3.338 0 0 1 3.332 3.333zm11.565-3.644a3.658 3.658 0 0 1-1.987.591 3.642 3.642 0 0 1-1.872-.529l.008.012a3.728 3.728 0 0 1-1.235-1.19l-2.612-3.693a.17.17 0 0 1-.027-.033A3.312 3.312 0 0 0 7.67 5.298a3.318 3.318 0 0 0-2.848 1.586.146.146 0 0 1-.021.028l-3.428 5.343a3.663 3.663 0 0 1 5.094 1.18.13.13 0 0 1 .015.018l2.756 3.869a3.305 3.305 0 0 0 2.699 1.38 3.31 3.31 0 0 0 2.711-1.379l.009-.013c.073-.103.137-.202.195-.305l1.442-2.255 1.935-3.024zm5.275 1.902l-.014-.028-.044-.066a1.109 1.109 0 0 0-.029-.044l-3.525-5.37c.024.168.052.335.052.51 0 .741-.219 1.457-.634 2.068l-2.803 4.38 1.416 2.179-.002.002a.131.131 0 0 1 .024.028 3.338 3.338 0 0 0 2.723 1.415A3.335 3.335 0 0 0 24 15.37c0-.613-.171-1.216-.496-1.742zm-7.262-1.666a3.336 3.336 0 0 0 3.332-3.333 3.336 3.336 0 0 0-3.332-3.332 3.336 3.336 0 0 0-3.332 3.332 3.338 3.338 0 0 0 3.332 3.333z',
    ],
  },
  goatcounter: {
    viewBox: '0 0 417 429',
    d: [
      'M25.399,235.075l118.517,-135.285c0,0 -124.734,-57.004 -120.995,-58.98c182.412,-96.381 370.769,214.033 370.769,214.033l-24.839,65.501c0,0 -169.954,-0.509 -192.464,-75.727',
      'M179.11,406.252c-0.044,-36.273 38.389,-117.225 38.389,-117.225',
    ],
    stroke: 44.5,
  },
  ga4: {
    viewBox: '0 0 24 24',
    d: [
      'M22.84 2.9982v17.9987c.0086 1.6473-1.3197 2.9897-2.967 2.9984a2.9808 2.9808 0 01-.3677-.0208c-1.528-.226-2.6477-1.5558-2.6105-3.1V3.1204c-.0369-1.5458 1.0856-2.8762 2.6157-3.1 1.6361-.1915 3.1178.9796 3.3093 2.6158.014.1201.0208.241.0202.3619zM4.1326 18.0548c-1.6417 0-2.9726 1.331-2.9726 2.9726C1.16 22.6691 2.4909 24 4.1326 24s2.9726-1.3309 2.9726-2.9726-1.331-2.9726-2.9726-2.9726zm7.8728-9.0098c-.0171 0-.0342 0-.0513.0003-1.6495.0904-2.9293 1.474-2.891 3.1256v7.9846c0 2.167.9535 3.4825 2.3505 3.763 1.6118.3266 3.1832-.7152 3.5098-2.327.04-.1974.06-.3983.0593-.5998v-8.9585c.003-1.6474-1.33-2.9852-2.9773-2.9882z',
    ],
  },
  posthog: {
    viewBox: '0 0 24 24',
    d: [
      'M9.854 14.5 5 9.647.854 5.5A.5.5 0 0 0 0 5.854V8.44a.5.5 0 0 0 .146.353L5 13.647l.147.146L9.854 18.5l.146.147v-.049c.065.03.134.049.207.049h2.586a.5.5 0 0 0 .353-.854L9.854 14.5zm0-5-4-4a.487.487 0 0 0-.409-.144.515.515 0 0 0-.356.21.493.493 0 0 0-.089.288V8.44a.5.5 0 0 0 .147.353l9 9a.5.5 0 0 0 .853-.354v-2.585a.5.5 0 0 0-.146-.354l-5-5zm1-4a.5.5 0 0 0-.854.354V8.44a.5.5 0 0 0 .147.353l4 4a.5.5 0 0 0 .853-.354V9.854a.5.5 0 0 0-.146-.354l-4-4zm12.647 11.515a3.863 3.863 0 0 1-2.232-1.1l-4.708-4.707a.5.5 0 0 0-.854.354v6.585a.5.5 0 0 0 .5.5H23.5a.5.5 0 0 0 .5-.5v-.6c0-.276-.225-.497-.499-.532zm-5.394.032a.8.8 0 1 1 0-1.6.8.8 0 0 1 0 1.6zM.854 15.5a.5.5 0 0 0-.854.354v2.293a.5.5 0 0 0 .5.5h2.293c.222 0 .39-.135.462-.309a.493.493 0 0 0-.109-.545L.854 15.501zM5 14.647.854 10.5a.5.5 0 0 0-.854.353v2.586a.5.5 0 0 0 .146.353L4.854 18.5l.146.147h2.793a.5.5 0 0 0 .353-.854L5 14.647z',
    ],
  },
}

function SourceMark({ source }: { source: ImportSource }) {
  const mark = MARKS[source]
  return (
    <span className="analytik-source-mark" data-source={source} aria-hidden="true">
      <svg viewBox={mark.viewBox} width="26" height="26">
        {mark.d.map((path) =>
          mark.stroke ? (
            <path
              key={path}
              d={path}
              fill="none"
              stroke="currentColor"
              strokeWidth={mark.stroke}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : (
            <path key={path} d={path} fill="currentColor" />
          ),
        )}
      </svg>
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
        accept=".csv,.json,.jsonl,.ndjson,text/csv,application/json"
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
