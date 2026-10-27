import { Popover as BasePopover } from '@base-ui/react/popover'
import type { ReactElement, ReactNode } from 'react'

import { useLayer } from './layer'

export interface PopoverProps {
  /** The button that opens the popover. */
  trigger: ReactElement
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Accessible name of the popup. */
  label: string
  className?: string
  children: ReactNode
}

/** A non-modal floating panel anchored to its trigger; Escape and outside clicks close it. */
export function Popover({ trigger, open, onOpenChange, label, className, children }: PopoverProps) {
  const layer = useLayer()
  return (
    <BasePopover.Root open={open} onOpenChange={onOpenChange}>
      <BasePopover.Trigger render={trigger} />
      <BasePopover.Portal container={layer.container} className={layer.className}>
        <BasePopover.Positioner className="analytik-positioner" sideOffset={8} align="start" collisionPadding={12}>
          <BasePopover.Popup className={['analytik-popup', className].filter(Boolean).join(' ')} aria-label={label}>
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  )
}
