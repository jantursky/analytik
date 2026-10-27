import { useState } from 'react'

import { Dialog } from '../ui/dialog'
import { BLOCK_IDS, BLOCKS, type BlockCategory, type BlockId } from './blocks'
import { BlockPreview } from './BlockPreview'

const CATEGORIES: readonly BlockCategory[] = ['Traffic', 'Content', 'Audience', 'Revenue', 'Live']

export interface BlockPickerProps {
  open: boolean
  /** Where the block goes, e.g. "after Pages" or "at the end". */
  place: string
  /** Blocks already on the overview; they show but cannot be picked. */
  used: ReadonlySet<BlockId>
  onPick: (id: BlockId) => void
  onClose: () => void
}

/** The block catalogue: categories with counts on the left, each block drawn small with sample numbers on the right. */
export function BlockPicker({ open, place, used, onPick, onClose }: BlockPickerProps) {
  const [category, setCategory] = useState<BlockCategory | 'All'>('All')
  const [chosen, setChosen] = useState<BlockId>()
  const shown = BLOCK_IDS.filter((id) => category === 'All' || BLOCKS[id].category === category)
  const pick = chosen && !used.has(chosen) ? chosen : undefined
  // Each opening starts from the whole catalogue.
  const clear = (): void => {
    setChosen(undefined)
    setCategory('All')
  }
  const close = (): void => {
    clear()
    onClose()
  }
  const add = (id = pick): void => {
    if (!id) return
    clear()
    onPick(id)
  }
  const count = (c: BlockCategory | 'All') => BLOCK_IDS.filter((id) => c === 'All' || BLOCKS[id].category === c).length

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && close()}
      title="Add a block"
      size="large"
      footer={
        <>
          <p className="analytik-muted">
            {pick ? (
              <>
                <strong>{BLOCKS[pick].name}</strong> goes {place}.
              </>
            ) : (
              `Pick a block to add ${place}.`
            )}
          </p>
          <button type="button" className="analytik-button" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="analytik-button"
            data-variant="primary"
            disabled={!pick}
            onClick={() => add()}
          >
            Add block
          </button>
        </>
      }
    >
      <div className="analytik-picker">
        <nav className="analytik-picker-nav" aria-label="Block categories">
          {(['All', ...CATEGORIES] as const).map((c) => (
            <button
              key={c}
              type="button"
              className="analytik-picker-category"
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
            >
              {c === 'All' ? 'All blocks' : c}
              <span className="analytik-muted">{count(c)}</span>
            </button>
          ))}
        </nav>
        <div className="analytik-picker-grid" role="radiogroup" aria-label="Blocks">
          {shown.map((id) => {
            const block = BLOCKS[id]
            const added = used.has(id)
            return (
              <button
                key={id}
                type="button"
                role="radio"
                className="analytik-picker-tile"
                aria-checked={chosen === id}
                aria-disabled={added || undefined}
                onClick={() => !added && setChosen(id)}
                onDoubleClick={() => !added && add(id)}
              >
                <span className="analytik-picker-head">
                  <strong>{block.name}</strong>
                  <span className="analytik-badge" data-category={block.category}>
                    {added ? 'On the overview' : block.category}
                  </span>
                </span>
                <BlockPreview id={id} />
                <span className="analytik-muted">{block.description}</span>
              </button>
            )
          })}
        </div>
      </div>
    </Dialog>
  )
}
