import { Children, cloneElement, type MouseEvent, type ReactElement } from 'react'

import type { Props } from '../shared/types'
import { useAnalytik } from './hooks'

export interface TrackClickProps {
  /** Goal name. */
  event: string
  props?: Props
  /** One element; its own `onClick` still runs. */
  children: ReactElement<{ onClick?: (event: MouseEvent<HTMLElement>) => void }>
}

/** Tracks a goal when its child is clicked. */
export function TrackClick({ event, props, children }: TrackClickProps) {
  const analytik = useAnalytik()
  const child = Children.only(children)
  return cloneElement(child, {
    onClick: (e: MouseEvent<HTMLElement>) => {
      analytik.track(event, props)
      child.props.onClick?.(e)
    },
  })
}
