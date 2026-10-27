import { MotionConfig } from 'motion/react'
import { createContext, type ReactNode, use, useMemo } from 'react'

import type { Filters, Query, Site } from '../shared/types'
import type { ApiClient } from './api'
import type { DashboardView } from './Dashboard'
import { OwnPreferences } from './preferences'
import type { DateRange } from './range'

export interface DashboardState {
  client: ApiClient
  /** Absolute API base URL, used in snippets and webhook URLs. */
  apiUrl: string
  site: Site
  range: DateRange
  filters: Filters
  /** The stats query for the range and filters, in the site timezone. */
  query: Query
  addFilter: (dimension: string, value: string) => void
  /** Called after the site was saved in settings. */
  onSiteChange: (site: Site) => void
  /** Switches the dashboard view; undefined when the parts are rendered without `<Dashboard>`. */
  openView?: (view: DashboardView) => void
  /** The overview layout editor is open (the toolbar's Customize button). */
  customizing?: boolean
}

const DashboardContext = createContext<DashboardState | null>(null)

/** State shared by the dashboard views. */
export function useDashboard(): DashboardState {
  const state = use(DashboardContext)
  if (!state) throw new Error('analytik dashboard parts must be rendered inside <Dashboard> or <DashboardProvider>')
  return state
}

export interface DashboardProviderProps {
  client: ApiClient
  apiUrl: string
  site: Site
  range: DateRange
  filters?: Filters
  onFilter?: (dimension: string, value: string) => void
  onSiteChange?: (site: Site) => void
  /** Lets parts link to other views, e.g. "Open live map" to the realtime view. */
  onViewChange?: (view: DashboardView) => void
  /** Opens the overview layout editor. */
  customizing?: boolean
  children: ReactNode
}

const ignore = (): void => undefined

/**
 * Renders dashboard parts (`<Overview />`, `<Sources />`, ...) outside `<Dashboard>`. Their settings (the overview
 * layout and chart choices) are saved through `client`, like in the full dashboard.
 */
export function DashboardProvider({
  client,
  apiUrl,
  site,
  range,
  filters = {},
  onFilter = ignore,
  onSiteChange = ignore,
  onViewChange,
  customizing,
  children,
}: DashboardProviderProps) {
  const value = useMemo<DashboardState>(
    () => ({
      client,
      apiUrl,
      site,
      range,
      filters,
      query: { from: range.from, to: range.to, interval: range.interval, tz: site.timezone, filters },
      addFilter: onFilter,
      onSiteChange,
      openView: onViewChange,
      customizing,
    }),
    [client, apiUrl, site, range, filters, onFilter, onSiteChange, onViewChange, customizing],
  )
  // Motion follows the visitor's reduced-motion setting here and in <Dashboard>.
  return (
    <MotionConfig reducedMotion="user">
      <DashboardContext value={value}>
        <OwnPreferences client={client}>{children}</OwnPreferences>
      </DashboardContext>
    </MotionConfig>
  )
}

/** A stable cache key for a request. */
export const requestKey = (...parts: unknown[]): string => JSON.stringify(parts)
