import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip'
import { cloneElement, type ReactElement, type ReactNode, useState } from 'react'

import { useLayer } from './layer'

/**
 * A label shown on hover and keyboard focus. The trigger keeps its own accessible name. `rich` is a card for longer
 * content such as a list of facts, instead of the small dark label. With `tap`, a press or tap on the trigger also
 * toggles it, which hover and focus alone can't do on a touch screen.
 */
export function Tooltip({
  label,
  rich,
  tap,
  children,
}: {
  label: ReactNode
  rich?: boolean
  tap?: boolean
  children: ReactElement<{ onClick?: () => void }>
}) {
  const layer = useLayer()
  const [open, setOpen] = useState(false)
  const own = tap
    ? {
        open,
        onOpenChange: (next: boolean, details: { reason: string }) => {
          if (details.reason !== 'trigger-press') setOpen(next)
        },
      }
    : {}
  return (
    <BaseTooltip.Root {...own}>
      <BaseTooltip.Trigger
        render={tap ? cloneElement(children, { onClick: () => setOpen((was) => !was) }) : children}
        delay={300}
      />
      <BaseTooltip.Portal container={layer.container} className={layer.className}>
        <BaseTooltip.Positioner sideOffset={8}>
          <BaseTooltip.Popup className="analytik-tooltip" data-rich={rich ? '' : undefined}>
            {label}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  )
}
