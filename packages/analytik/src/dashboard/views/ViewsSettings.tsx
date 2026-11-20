import { Reorder, useDragControls } from 'motion/react'
import { useState } from 'react'

import { Icon } from '../icons'
import { msg, t } from '../i18n'
import { parseStartView, parseViews, SITE_VIEWS, type SiteViewId, usePreferences } from '../preferences'
import { Card } from '../ui'
import { Select } from '../ui/select'
import { Switch } from '../ui/switch'
import { moveItem } from './Overview'

const LABELS: Record<SiteViewId, string> = {
  overview: msg('Overview'),
  sources: msg('Acquisition'),
  pages: msg('Pages'),
  events: msg('Events'),
  bots: msg('Bots'),
  funnels: msg('Funnels'),
  journeys: msg('Journeys'),
  retention: msg('Retention'),
  revenue: msg('Revenue'),
  sessions: msg('Sessions'),
  realtime: msg('Live'),
}

interface RowProps {
  id: SiteViewId
  index: number
  count: number
  shown: boolean
  onlyOne: boolean
  onToggle: () => void
  onMove: (by: -1 | 1) => void
}

/** One view: a switch, move buttons (the keyboard way) and a handle to drag it. Hidden views stay below the shown ones. */
function Row({ id, index, count, shown, onlyOne, onToggle, onMove }: RowProps) {
  const controls = useDragControls()
  const name = t(LABELS[id])
  const content = (
    <>
      {shown && (
        <span
          className="analytik-view-grip"
          role="img"
          aria-label={t('Drag {name} to reorder', { name })}
          onPointerDown={(event) => controls.start(event)}
        >
          <Icon name="grip" />
        </span>
      )}
      <Switch checked={shown} disabled={shown && onlyOne} onChange={onToggle}>
        {name}
      </Switch>
      {shown && (
        <span className="analytik-view-moves">
          <button
            type="button"
            className="analytik-pill-icon"
            aria-label={t('Move {name} earlier', { name })}
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <Icon name="up" />
          </button>
          <button
            type="button"
            className="analytik-pill-icon"
            aria-label={t('Move {name} later', { name })}
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          >
            <Icon name="down" />
          </button>
        </span>
      )}
    </>
  )
  return shown ? (
    <Reorder.Item as="li" value={id} dragListener={false} dragControls={controls} className="analytik-view-row">
      {content}
    </Reorder.Item>
  ) : (
    <li className="analytik-view-row" data-hidden="">
      {content}
    </li>
  )
}

/** Which views the navigation shows, in what order, and which one opens first. Saved with the other preferences. */
export function ViewsCard() {
  const { values, update } = usePreferences()
  const visible = parseViews(values.views)
  const hidden = SITE_VIEWS.filter((id) => !visible.includes(id))
  const [announcement, setAnnouncement] = useState('')
  const save = (next: SiteViewId[]): void => {
    // Every view in the default order is the default, which is stored as nothing.
    update({
      views: next.length === SITE_VIEWS.length && next.every((id, i) => id === SITE_VIEWS[i]) ? undefined : next,
    })
  }
  const move = (id: SiteViewId, by: -1 | 1): void => {
    const from = visible.indexOf(id)
    const next = moveItem(visible, from, by)
    save(next)
    setAnnouncement(
      t('{name} is now number {number} of {count}', {
        name: t(LABELS[id]),
        number: next.indexOf(id) + 1,
        count: next.length,
      }),
    )
  }
  const toggle = (id: SiteViewId): void => {
    if (!visible.includes(id)) save([...visible, id])
    else if (visible.length > 1) save(visible.filter((view) => view !== id))
  }
  const start = parseStartView(values.startView, visible)
  const reset = (): void => update({ views: undefined, startView: undefined })
  return (
    <Card
      title={t('Views')}
      description={t('Choose which views the navigation shows, and in what order. Saved for every admin.')}
      actions={
        <button type="button" className="analytik-button" onClick={reset}>
          {t('Reset')}
        </button>
      }
    >
      <div className="analytik-view-rows">
        <Reorder.Group as="ul" axis="y" values={visible} onReorder={save} className="analytik-view-group">
          {visible.map((id, index) => (
            <Row
              key={id}
              id={id}
              index={index}
              count={visible.length}
              shown
              onlyOne={visible.length === 1}
              onToggle={() => toggle(id)}
              onMove={(by) => move(id, by)}
            />
          ))}
        </Reorder.Group>
        {hidden.length > 0 && (
          <ul className="analytik-view-group">
            {hidden.map((id) => (
              <Row
                key={id}
                id={id}
                index={0}
                count={0}
                shown={false}
                onlyOne={false}
                onToggle={() => toggle(id)}
                onMove={() => undefined}
              />
            ))}
          </ul>
        )}
      </div>
      <p className="analytik-sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      <Select
        label={t('Start page')}
        value={start}
        options={visible.map((id) => ({ value: id, label: t(LABELS[id]) }))}
        onChange={(value) => update({ startView: value === 'overview' ? undefined : value })}
      />
    </Card>
  )
}
