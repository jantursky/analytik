import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip'
import type { ReactElement, ReactNode } from 'react'

import { useLayer } from './layer'

/**
 * A label shown on hover and keyboard focus. The trigger keeps its own accessible name. `rich` is a card for longer
 * content such as a list of facts, instead of the small dark label.
 */
export function Tooltip({ label, rich, children }: { label: ReactNode; rich?: boolean; children: ReactElement }) {
  const layer = useLayer()
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} delay={300} />
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
