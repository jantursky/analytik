import { Menu } from '@base-ui/react/menu'
import { type SubmitEvent, useState } from 'react'

import { MAX_SEGMENT_NAME, MAX_SEGMENTS, parseSegments, type Segment } from '../shared/segments'
import type { Filters } from '../shared/types'
import { Icon } from './icons'
import { t } from './i18n'
import { usePreferences } from './preferences'
import { Field } from './ui'
import { Dialog } from './ui/dialog'
import { useLayer } from './ui/layer'

/** Whether two filter sets are the same filters, whatever their order. */
export function sameFilters(a: Filters, b: Filters): boolean {
  const keys = (filters: Filters) => Object.keys(filters).filter((key) => filters[key] != null)
  const left = keys(a)
  return left.length === keys(b).length && left.every((key) => a[key] === b[key])
}

/** The saved segments (kept with the other dashboard settings) and ways to change them. */
export function useSegments(): { segments: Segment[]; save: (segments: Segment[]) => void } {
  const { values, update } = usePreferences()
  return {
    segments: parseSegments(values.segments),
    save: (segments) => update({ segments: segments.length > 0 ? segments : undefined }),
  }
}

const newId = (): string =>
  typeof crypto.randomUUID === 'function' ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10)

/**
 * Saved sets of filters. The menu applies one (replacing the active filters, which loads each block once), saves the
 * active filters under a name, and opens a dialog to rename or delete them.
 */
export function SegmentMenu({ filters, onApply }: { filters: Filters; onApply: (filters: Filters) => void }) {
  const { segments, save } = useSegments()
  const layer = useLayer()
  const [dialog, setDialog] = useState<'save' | 'manage' | null>(null)
  const [name, setName] = useState('')
  const [problem, setProblem] = useState('')
  const active = Object.values(filters).some((value) => value != null)
  const current = segments.find((segment) => sameFilters(segment.filters, filters))

  const submit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    if (segments.length >= MAX_SEGMENTS) {
      setProblem(t('You can keep up to {count} segments. Delete one to save another.', { count: MAX_SEGMENTS }))
      return
    }
    save([...segments, { id: newId(), name: trimmed.slice(0, MAX_SEGMENT_NAME), filters: { ...filters } }])
    setDialog(null)
  }

  return (
    <>
      <Menu.Root>
        <Menu.Trigger className="analytik-link analytik-segments-trigger">
          <Icon name="filter" />
          {t('Segments')}
        </Menu.Trigger>
        <Menu.Portal container={layer.container} className={layer.className}>
          <Menu.Positioner className="analytik-positioner" sideOffset={6} align="start">
            <Menu.Popup className="analytik-popup analytik-menu">
              {segments.length === 0 && <div className="analytik-menu-empty">{t('No saved segments yet')}</div>}
              {segments.map((segment) => (
                <Menu.Item
                  key={segment.id}
                  className="analytik-menu-item"
                  onClick={() => onApply({ ...segment.filters })}
                >
                  <span className="analytik-menu-text">{segment.name}</span>
                  {segment.id === current?.id && <Icon name="check" />}
                </Menu.Item>
              ))}
              <Menu.Separator className="analytik-menu-separator" />
              <Menu.Item
                className="analytik-menu-item"
                disabled={!active}
                onClick={() => {
                  setName('')
                  setProblem('')
                  setDialog('save')
                }}
              >
                {t('Save the active filters…')}
              </Menu.Item>
              {segments.length > 0 && (
                <Menu.Item className="analytik-menu-item" onClick={() => setDialog('manage')}>
                  {t('Manage segments…')}
                </Menu.Item>
              )}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>

      <Dialog open={dialog === 'save'} onOpenChange={(open) => !open && setDialog(null)} title={t('Save segment')}>
        <form className="analytik-segment-form" onSubmit={submit}>
          <Field
            label={t('Name')}
            error={problem ? { id: 'analytik-segment-problem', text: problem } : null}
            hint={t('The active filters are saved under this name and apply in one click.')}
          >
            <input
              className="analytik-input"
              value={name}
              maxLength={MAX_SEGMENT_NAME}
              placeholder={t('For example, Slovak organic')}
              aria-describedby={problem ? 'analytik-segment-problem' : undefined}
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <div className="analytik-actions analytik-card-actions">
            <button type="submit" className="analytik-button" data-variant="primary" disabled={!name.trim()}>
              {t('Save')}
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog open={dialog === 'manage'} onOpenChange={(open) => !open && setDialog(null)} title={t('Manage segments')}>
        <ul className="analytik-segment-list">
          {segments.map((segment) => (
            <li key={segment.id}>
              <input
                className="analytik-input"
                aria-label={t('Segment name')}
                defaultValue={segment.name}
                maxLength={MAX_SEGMENT_NAME}
                onBlur={(event) => {
                  const renamed = event.target.value.trim()
                  if (!renamed) event.target.value = segment.name
                  else if (renamed !== segment.name) {
                    save(segments.map((s) => (s.id === segment.id ? { ...s, name: renamed } : s)))
                  }
                }}
                onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
              />
              <button
                type="button"
                className="analytik-pill-icon"
                aria-label={t('Delete segment {name}', { name: segment.name })}
                onClick={() => save(segments.filter((s) => s.id !== segment.id))}
              >
                <Icon name="trash" />
              </button>
            </li>
          ))}
          {segments.length === 0 && <li className="analytik-menu-empty">{t('No saved segments yet')}</li>}
        </ul>
      </Dialog>
    </>
  )
}
