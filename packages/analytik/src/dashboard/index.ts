'use client'

export { Dashboard, type DashboardProps, type DashboardView } from './Dashboard'
export { DashboardProvider, type DashboardProviderProps, type DashboardState, useDashboard } from './context'
export {
  RequestError,
  createApiClient,
  queryParams,
  type ApiClient,
  type EventRow,
  type ExportFormat,
  type Fetcher,
  type FunnelInput,
  type Paging,
  type PaymentFilters,
  type SessionDetail,
  type SiteInput,
  type SitePatch,
} from './api'
export {
  AreaChart,
  BarList,
  Sparkline,
  type AreaChartProps,
  type AreaChartSecondary,
  type BarListProps,
  type BarListRow,
  type ChartPoint,
} from './charts'
export { AddSiteDialog, CreateSiteForm, LoginForm, type AddSiteDialogProps } from './Login'
export { WorldMap, type WorldMapProps } from './map'
export { customRange, presetRange, RANGE_PRESETS, shiftRange, type DateRange, type RangePreset } from './range'
export { buildCampaignUrl, buildSnippet, type CampaignParams, type SnippetOptions } from './snippet'
export { FilterBar, IntervalPicker, RangePicker } from './Toolbar'
export { DeltaBadge, StatTile, type FaviconSource, type StatTileProps } from './ui'
export { BreakdownCard, type BreakdownCardProps, type BreakdownMetric } from './views/Breakdown'
export { Events } from './views/Events'
export { Funnels } from './views/Funnels'
export { Pages, Sources } from './views/Lists'
export { Overview, type OverviewProps } from './views/Overview'
export { Realtime } from './views/Realtime'
export { Revenue } from './views/Revenue'
export { SessionTimeline, Sessions } from './views/Sessions'
export { SitesOverview, type SitesOverviewProps } from './views/Sites'
export {
  CampaignLinkBuilder,
  PrivacySettings,
  Settings,
  type SettingsSection,
  SiteSettings,
  SnippetGenerator,
} from './views/Settings'
