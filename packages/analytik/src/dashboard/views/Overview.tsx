import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'

import { useDashboard } from '../context'
import { usePreferences } from '../preferences'
import { Icon } from '../icons'
import { EASE, View } from '../ui/motion'
import { BLOCK_IDS, BLOCKS, type BlockId } from './blocks'
import { BlockPicker } from './BlockPicker'
import { t } from '../i18n'

export { useOverview } from './useOverview'

export interface LayoutItem {
  id: BlockId
  /** Spans both columns. */
  wide: boolean
}

const DEFAULT_IDS: readonly BlockId[] = ['summary', 'sources', 'locations', 'pages', 'technology', 'goals']

export const DEFAULT_LAYOUT: readonly LayoutItem[] = DEFAULT_IDS.map((id) => ({ id, wide: BLOCKS[id].wide }))

const isBlock = (id: unknown): id is BlockId => typeof id === 'string' && (BLOCK_IDS as string[]).includes(id)

/**
 * A saved layout (the list, or its JSON), cleaned up: unknown and repeated blocks dropped; nothing usable gives the
 * default.
 */
export function parseLayout(stored: unknown): LayoutItem[] {
  let items: LayoutItem[] = []
  try {
    const parsed: unknown = typeof stored === 'string' ? JSON.parse(stored) : stored
    if (Array.isArray(parsed)) {
      items = parsed
        .filter(
          (item): item is { id: BlockId; wide?: unknown } =>
            !!item && typeof item === 'object' && isBlock((item as LayoutItem).id),
        )
        .map((item) => ({ id: item.id, wide: item.wide === true }))
    }
  } catch {
    // A broken value counts as none.
  }
  const unique = items.filter((item, index) => items.findIndex((other) => other.id === item.id) === index)
  return unique.length ? unique : [...DEFAULT_LAYOUT]
}

/** The blocks of the overview, their order and width, saved with the dashboard settings. */
function useLayout(): [LayoutItem[], (next: LayoutItem[]) => void] {
  const { values, update } = usePreferences()
  return [parseLayout(values.layout), (layout) => update({ layout })]
}

/** Moves the item at `index` by `by` places, staying in bounds. */
export function moveItem<T>(items: readonly T[], index: number, by: number): T[] {
  const target = Math.max(0, Math.min(items.length - 1, index + by))
  const next = [...items]
  const [item] = next.splice(index, 1)
  if (item !== undefined) next.splice(target, 0, item)
  return next
}

interface BlockChange {
  move?: number
  wide?: boolean
  remove?: boolean
}

function BlockControls({
  item,
  index,
  count,
  onChange,
}: {
  item: LayoutItem
  index: number
  count: number
  onChange: (change: BlockChange) => void
}) {
  const name = t(BLOCKS[item.id].name)
  return (
    <div className="analytik-block-bar" role="group" aria-label={t('{name} layout', { name })}>
      <span className="analytik-block-name">{name}</span>
      <button
        type="button"
        className="analytik-pill-icon"
        aria-label={t('Move {name} earlier', { name })}
        disabled={index === 0}
        onClick={() => onChange({ move: -1 })}
      >
        <Icon name="prev" />
      </button>
      <button
        type="button"
        className="analytik-pill-icon"
        aria-label={t('Move {name} later', { name })}
        disabled={index === count - 1}
        onClick={() => onChange({ move: 1 })}
      >
        <Icon name="next" />
      </button>
      <button
        type="button"
        className="analytik-block-toggle"
        aria-pressed={item.wide}
        onClick={() => onChange({ wide: !item.wide })}
      >
        {item.wide ? t('Full width') : t('Half width')}
      </button>
      <button
        type="button"
        className="analytik-pill-icon"
        aria-label={t('Remove {name}', { name })}
        onClick={() => onChange({ remove: true })}
      >
        <Icon name="trash" />
      </button>
    </div>
  )
}

/** Where a picked block goes: at an index of the layout, described for the picker. */
interface Insertion {
  index: number
  label: string
}

export interface OverviewProps {
  /** Shows the layout editor. Without it, the overview follows the dashboard toolbar's Customize button. */
  customizing?: boolean
}

/**
 * The overview: blocks in two columns, by default the summary and five breakdowns. While customizing, blocks can be
 * moved, made full or half width, removed, and new ones added from a catalogue at the end or next to another block.
 */
export function Overview({ customizing }: OverviewProps = {}) {
  const { customizing: fromToolbar } = useDashboard()
  const editing = customizing ?? fromToolbar ?? false
  const [layout, setLayout] = useLayout()
  const [insertion, setInsertion] = useState<Insertion>()
  const change = (index: number, edit: BlockChange): void => {
    if (edit.remove) {
      setLayout(layout.filter((_, i) => i !== index))
      return
    }
    const next = layout.map((item, i) => (i === index && edit.wide !== undefined ? { ...item, wide: edit.wide } : item))
    setLayout(edit.move ? moveItem(next, index, edit.move) : next)
  }
  const add = (ids: BlockId[]): void => {
    if (!insertion) return
    const next = [...layout]
    next.splice(insertion.index, 0, ...ids.map((id) => ({ id, wide: BLOCKS[id].wide })))
    setLayout(next)
    setInsertion(undefined)
  }
  const used = new Set(layout.map((item) => item.id))
  const full = used.size === BLOCK_IDS.length

  return (
    <View>
      <div className="analytik-board" data-editing={editing ? '' : undefined}>
        {layout.map((item, index) => {
          const name = t(BLOCKS[item.id].name)
          return (
            <motion.div
              key={item.id}
              layout="position"
              className="analytik-block"
              data-wide={item.wide ? '' : undefined}
              data-configurable={'configurable' in BLOCKS[item.id] ? '' : undefined}
              // Each block starts its own entrance, so one added later fades in too instead of staying hidden.
              initial="hidden"
              animate="show"
              variants={{ hidden: {}, show: { transition: { delayChildren: Math.min(index, 8) * 0.05 } } }}
              transition={{ duration: 0.3, ease: EASE }}
            >
              {editing && (
                <>
                  <BlockControls item={item} index={index} count={layout.length} onChange={(e) => change(index, e)} />
                  {!full &&
                    (['before', 'after'] as const).map((side) => (
                      <button
                        key={side}
                        type="button"
                        className="analytik-insert"
                        data-side={side}
                        aria-label={
                          side === 'before'
                            ? t('Add a block before {name}', { name })
                            : t('Add a block after {name}', { name })
                        }
                        onClick={() =>
                          setInsertion({
                            index: side === 'before' ? index : index + 1,
                            label: side === 'before' ? t('before {name}', { name }) : t('after {name}', { name }),
                          })
                        }
                      >
                        <Icon name="plus" />
                      </button>
                    ))}
                </>
              )}
              {BLOCKS[item.id].render({ editing })}
            </motion.div>
          )
        })}
        <AnimatePresence>
          {editing && (
            <motion.div
              key="add"
              className="analytik-block analytik-add-block"
              data-wide={layout.length % 2 === 0 ? '' : undefined}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <button
                type="button"
                className="analytik-add-tile"
                disabled={full}
                onClick={() => setInsertion({ index: layout.length, label: t('at the end') })}
              >
                <span className="analytik-add-icon" aria-hidden="true">
                  <Icon name="plus" />
                </span>
                <strong>{full ? t('Every block is on the overview') : t('Add a block')}</strong>
                <span className="analytik-muted">
                  {full
                    ? t('Remove one to add it somewhere else.')
                    : t('Charts, tables and numbers from the catalogue.')}
                </span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <BlockPicker
        open={!!insertion}
        place={insertion?.label ?? ''}
        used={used}
        onPick={add}
        onClose={() => setInsertion(undefined)}
      />
    </View>
  )
}
