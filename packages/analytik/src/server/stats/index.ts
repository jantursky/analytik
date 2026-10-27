import type { Context } from '../context'
import { AnalytikError } from '../context'
import { requireSite } from '../sites'
import type { StatsApi } from '../types'
import { events, payments, realtime, sessionDetail, sessions } from './activity'
import { breakdown } from './breakdown'
import { EXPORT_TABLES, exportCsv, exportJson } from './export'
import { funnelResult, getFunnel } from './funnels'
import { overview, timeseries } from './overview'
import { purgeBefore } from './purge'
import { isDimension, pageLimit, toStatsQuery } from './query'

export function createStatsApi(ctx: Context, ready: () => Promise<unknown>): StatsApi {
  const load = async (siteId: string) => {
    await ready()
    return requireSite(ctx, siteId)
  }
  return {
    async overview(siteId, query) {
      const site = await load(siteId)
      return overview(ctx, site, toStatsQuery(site, query))
    },
    async timeseries(siteId, query) {
      const site = await load(siteId)
      return timeseries(ctx, site, toStatsQuery(site, query))
    },
    async breakdown(siteId, dimension, query, options = {}) {
      if (!isDimension(dimension)) throw new AnalytikError(`unknown dimension ${String(dimension)}`)
      const site = await load(siteId)
      return breakdown(ctx, site, dimension, toStatsQuery(site, query), pageLimit(options.limit ?? 100))
    },
    async realtime(siteId) {
      return realtime(ctx, await load(siteId))
    },
    async sessions(siteId, query, options) {
      const site = await load(siteId)
      return sessions(ctx, site, toStatsQuery(site, query), options)
    },
    async session(siteId, sessionId) {
      return sessionDetail(ctx, await load(siteId), sessionId)
    },
    async events(siteId, query, options) {
      const site = await load(siteId)
      return events(ctx, site, toStatsQuery(site, query), options)
    },
    async funnel(siteId, funnelId, query) {
      const site = await load(siteId)
      const funnel = await getFunnel(ctx, siteId, funnelId)
      return funnel ? funnelResult(ctx, site, funnel, toStatsQuery(site, query)) : null
    },
    async payments(siteId, query, options) {
      const site = await load(siteId)
      return payments(ctx, site, toStatsQuery(site, query), options)
    },
    async export(siteId, format, table = 'events') {
      const site = await load(siteId)
      if (format === 'json') return exportJson(ctx, site)
      if (EXPORT_TABLES.includes(table)) return exportCsv(ctx, site, table)
      throw new AnalytikError('unknown export format or table')
    },
    async purge(siteId, before) {
      await load(siteId)
      if (!Number.isFinite(before)) throw new AnalytikError('before must be a timestamp')
      return purgeBefore(ctx, siteId, before)
    },
  }
}
