import { useState } from 'react'

import { msg, t } from '../i18n'
import { Dialog } from '../ui/dialog'
import { BLOCK_IDS, BLOCKS, type BlockCategory, type BlockId } from './blocks'
import { BlockPreview, withNode } from './BlockPreview'

const CATEGORIES: readonly BlockCategory[] = [
  msg('Traffic'),
  msg('Content'),
  msg('Audience'),
  msg('Revenue'),
  msg('Live'),
]

export interface BlockPickerProps {
  open: boolean
  /** Where the block goes, e.g. "after Pages" or "at the end". */
  place: string
  /** Blocks already on the overview; they show but cannot be picked. */
  used: ReadonlySet<BlockId>
  /** The picked blocks, in the order they were chosen. */
  onPick: (ids: BlockId[]) => void
  onClose: () => void
}

/** The block catalogue: categories with counts on the left, each block drawn small with sample numbers on the right. */
export function BlockPicker({ open, place, used, onPick, onClose }: BlockPickerProps) {
  const [category, setCategory] = useState<BlockCategory | 'All'>('All')
  const [chosen, setChosen] = useState<BlockId[]>([])
  const shown = BLOCK_IDS.filter((id) => category === 'All' || BLOCKS[id].category === category)
  const picks = chosen.filter((id) => !used.has(id))
  // Each opening starts from the whole catalogue.
  const clear = (): void => {
    setChosen([])
    setCategory('All')
  }
  const close = (): void => {
    clear()
    onClose()
  }
  const toggle = (id: BlockId): void =>
    setChosen((ids) => (ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]))
  const add = (): void => {
    if (!picks.length) return
    const ids = picks
    clear()
    onPick(ids)
  }
  const count = (c: BlockCategory | 'All') => BLOCK_IDS.filter((id) => c === 'All' || BLOCKS[id].category === c).length

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && close()}
      title={t('Add a block')}
      size="large"
      footer={
        <>
          <p className="analytik-muted">
            {picks.length === 1 && picks[0]
              ? withNode(t('{block} goes {place}.', { place }), 'block', <strong>{t(BLOCKS[picks[0]].name)}</strong>)
              : picks.length
                ? withNode(
                    t('{blocks} go {place}.', { place }),
                    'blocks',
                    <strong>{t('{count, plural, one {# block} other {# blocks}}', { count: picks.length })}</strong>,
                  )
                : t('Pick one or more blocks to add {place}.', { place })}
          </p>
          <button type="button" className="analytik-button" onClick={close}>
            {t('Cancel')}
          </button>
          <button
            type="button"
            className="analytik-button"
            data-variant="primary"
            disabled={!picks.length}
            onClick={add}
          >
            {picks.length > 1
              ? t('{count, plural, one {Add # block} other {Add # blocks}}', { count: picks.length })
              : t('Add block')}
          </button>
        </>
      }
    >
      <div className="analytik-picker">
        <nav className="analytik-picker-nav" aria-label={t('Block categories')}>
          {(['All', ...CATEGORIES] as const).map((c) => (
            <button
              key={c}
              type="button"
              className="analytik-picker-category"
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
            >
              {c === 'All' ? t('All blocks') : t(c)}
              <span className="analytik-muted">{count(c)}</span>
            </button>
          ))}
        </nav>
        <div className="analytik-picker-grid" role="group" aria-label={t('Blocks')}>
          {shown.map((id) => {
            const block = BLOCKS[id]
            const added = used.has(id)
            return (
              <button
                key={id}
                type="button"
                role="checkbox"
                className="analytik-picker-tile"
                aria-checked={chosen.includes(id)}
                aria-disabled={added || undefined}
                onClick={() => !added && toggle(id)}
              >
                <span className="analytik-picker-head">
                  <strong>{t(block.name)}</strong>
                  <span className="analytik-badge" data-category={block.category}>
                    {added ? t('On the overview') : t(block.category)}
                  </span>
                </span>
                <BlockPreview id={id} />
                <span className="analytik-muted">{t(block.description)}</span>
              </button>
            )
          })}
        </div>
      </div>
    </Dialog>
  )
}
