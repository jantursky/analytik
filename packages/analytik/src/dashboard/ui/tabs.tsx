import { Tabs as BaseTabs } from '@base-ui/react/tabs'
import type { ReactNode } from 'react'

import { Reveal } from './motion'

export interface TabsProps<T extends string> {
  label: string
  tabs: readonly { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  /** Shown at the end of the tab row, e.g. a column heading. */
  extra?: ReactNode
  /** The content of the selected tab. */
  children: ReactNode
}

/** WAI-ARIA tabs with automatic activation (arrows, Home, End) and a pill that slides to the selected tab. */
export function Tabs<T extends string>({ label, tabs, value, onChange, extra, children }: TabsProps<T>) {
  return (
    <BaseTabs.Root value={value} onValueChange={(next) => onChange(next as T)}>
      <div className="analytik-tabs-row">
        <BaseTabs.List className="analytik-tabs" aria-label={label} activateOnFocus>
          {tabs.map((tab) => (
            <BaseTabs.Tab key={tab.value} value={tab.value} className="analytik-tab">
              {tab.label}
            </BaseTabs.Tab>
          ))}
          <BaseTabs.Indicator className="analytik-tab-indicator" />
        </BaseTabs.List>
        {extra}
      </div>
      <BaseTabs.Panel value={value} className="analytik-tab-panel">
        <Reveal id={value}>{children}</Reveal>
      </BaseTabs.Panel>
    </BaseTabs.Root>
  )
}
