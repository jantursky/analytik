'use client'

export { AnalytikProvider, type AnalytikProviderProps } from './context'
export { type LocationLike, useAnalytik, useTrackPageviews } from './hooks'
export { TrackClick, type TrackClickProps } from './TrackClick'
export { createClient } from '../client/index'
export type { Analytik, AnalytikClient, AnalytikOptions, IdentifyInput, RevenueOptions } from '../tracker/types'
