import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip'
import type { ReactElement } from 'react'

import { useLayer } from './layer'

/** A short text label shown on hover and keyboard focus. The trigger keeps its own accessible name. */
export function Tooltip({ label, children }: { label: string; children: ReactElement }) {
  const layer = useLayer()
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} delay={300} />
      <BaseTooltip.Portal container={layer.container} className={layer.className}>
        <BaseTooltip.Positioner sideOffset={8}>
          <BaseTooltip.Popup className="analytik-tooltip">{label}</BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  )
}
