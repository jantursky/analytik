import { type SubmitEvent, useState } from 'react'

import { t } from './i18n'
import { Icon } from './icons'

/** A note as the chart shows it: `ts` is the bucket it sits on, `at` the moment it is dated. */
export interface ChartNote {
  id: string
  ts: number
  at: number
  text: string
}

/** What the person at the chart may do with notes; left out when the dashboard is read-only. */
export interface NoteActions {
  /** `day` is `YYYY-MM-DD`, in the site's time zone. */
  add: (text: string, day: string) => Promise<unknown>
  edit: (id: string, text: string, day: string) => Promise<unknown>
  remove: (id: string) => Promise<unknown>
  /** The day the form starts on for a new note, and the day an existing note is on. */
  dayOf: (ts: number) => string
}

export type NotesView = { kind: 'list'; notes: ChartNote[] } | { kind: 'form'; note?: ChartNote }

const MAX_TEXT = 200

function NoteForm({
  note,
  actions,
  onDone,
}: {
  note?: ChartNote
  actions: NoteActions
  onDone: (changed: boolean) => void
}) {
  const [text, setText] = useState(note?.text ?? '')
  const [day, setDay] = useState(() => actions.dayOf(note?.at ?? Date.now()))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = (event: SubmitEvent): void => {
    event.preventDefault()
    if (!text.trim() || !day) return
    setBusy(true)
    const done = note ? actions.edit(note.id, text.trim(), day) : actions.add(text.trim(), day)
    done.then(
      () => onDone(true),
      (e: unknown) => {
        setBusy(false)
        setError(e instanceof Error ? e.message : String(e))
      },
    )
  }
  return (
    <form className="analytik-note-form" onSubmit={submit}>
      <label className="analytik-field">
        <span className="analytik-field-label">{t('Note')}</span>
        <input
          className="analytik-input"
          value={text}
          maxLength={MAX_TEXT}
          required
          autoFocus
          placeholder={t('Launched on Product Hunt')}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <label className="analytik-field">
        <span className="analytik-field-label">{t('Date')}</span>
        <input className="analytik-input" type="date" value={day} required onChange={(e) => setDay(e.target.value)} />
      </label>
      {error && (
        <p className="analytik-field-error" role="alert">
          {error}
        </p>
      )}
      <div className="analytik-actions">
        <button type="button" className="analytik-button" onClick={() => onDone(false)}>
          {t('Cancel')}
        </button>
        <button type="submit" className="analytik-button" data-variant="primary" disabled={busy}>
          {t('Save note')}
        </button>
      </div>
    </form>
  )
}

/** The notes under a marker with Edit and Delete, or the form that adds or changes one; shown under the chart. */
export function NotesPanel({
  view,
  actions,
  formatTime,
  onView,
  onClose,
  onChanged,
}: {
  view: NotesView
  actions?: NoteActions
  formatTime: (ts: number) => string
  onView: (view: NotesView) => void
  onClose: () => void
  onChanged: () => void
}) {
  const [error, setError] = useState('')
  if (view.kind === 'form' && actions) {
    return (
      <div className="analytik-notes-panel" role="group" aria-label={t('Notes')}>
        <NoteForm
          note={view.note}
          actions={actions}
          onDone={(changed) => {
            if (changed) onChanged()
            onClose()
          }}
        />
      </div>
    )
  }
  const notes = view.kind === 'list' ? view.notes : []
  const remove = (note: ChartNote): void => {
    void actions?.remove(note.id).then(
      () => {
        onChanged()
        const rest = notes.filter((n) => n.id !== note.id)
        if (rest.length) onView({ kind: 'list', notes: rest })
        else onClose()
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    )
  }
  return (
    <div className="analytik-notes-panel" role="group" aria-label={t('Notes')}>
      <ul className="analytik-notes-list">
        {notes.map((note) => (
          <li key={note.id}>
            <span className="analytik-muted">{formatTime(note.ts)}</span>
            <span className="analytik-note-text">{note.text}</span>
            {actions && (
              <span className="analytik-actions">
                <button
                  type="button"
                  className="analytik-link"
                  onClick={() => onView({ kind: 'form', note })}
                  aria-label={t('Edit note: {text}', { text: note.text })}
                >
                  {t('Edit')}
                </button>
                <button
                  type="button"
                  className="analytik-link"
                  onClick={() => remove(note)}
                  aria-label={t('Delete note: {text}', { text: note.text })}
                >
                  {t('Delete')}
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p className="analytik-field-error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="analytik-link" onClick={onClose}>
        <Icon name="close" />
        {t('Close')}
      </button>
    </div>
  )
}
