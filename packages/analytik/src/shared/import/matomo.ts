import { normalizeBrowser, normalizeCountry, normalizeDevice, normalizeOs, parseTimestamp, pathOf } from './normalize'
import { Row, type SourceRow } from './row'
import type { ImportEvent, ImportVisit } from './types'

export interface MatomoMapped {
  visits: ImportVisit[]
  skipped: { row: number; reason: string }[]
}

/** Fields a visit from `Live.getLastVisitsDetails` cannot do without. */
export const MATOMO_REQUIRED: readonly string[] = ['idVisit', 'actionDetails']

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Matomo's device types beyond desktop, tablet and the ones the tracker uses. */
function deviceOf(raw: string | null): ReturnType<typeof normalizeDevice> {
  const lower = raw?.toLowerCase()
  if (lower === 'smartphone' || lower === 'phablet' || lower === 'feature phone') return 'Mobile'
  return normalizeDevice(raw)
}

function referrerOf(row: Row): string | null {
  if (row.text('referrerType') === 'direct') return null
  return row.text('referrerUrl') ?? row.text('referrerName')
}

/**
 * Turns the visits of Matomo's `Live.getLastVisitsDetails` (format JSON) into visits. A Matomo visit is a visit, and
 * its `visitorId` is the visitor. Page views, events and goals are kept; downloads, outlinks, site searches and
 * actions without a time or a page are skipped and counted.
 */
export function mapMatomo(rows: readonly SourceRow[]): MatomoMapped {
  const skipped: MatomoMapped['skipped'] = []
  const visits: ImportVisit[] = []
  rows.forEach((raw, index) => {
    const number = index + 1
    const row = new Row(raw)
    const id = row.text('idVisit')
    const actions = (raw as { actionDetails?: unknown }).actionDetails
    if (!id || !Array.isArray(actions)) {
      skipped.push({ row: number, reason: 'idVisit or actionDetails is missing' })
      return
    }
    const fallback = parseTimestamp(raw.firstActionTimestamp ?? raw.serverTimestamp)
    const events: ImportEvent[] = []
    let hostname: string | null = null
    for (const action of actions) {
      if (!isRecord(action)) continue
      const item = new Row(action)
      const kind = item.text('type')
      const ts = parseTimestamp(action.timestamp) ?? fallback
      const path = pathOf(item.text('url'))
      if (ts === null) {
        skipped.push({ row: number, reason: 'an action has no time' })
        continue
      }
      if (kind === 'action' || kind === null) {
        if (!path) {
          skipped.push({ row: number, reason: 'a page view has no url' })
          continue
        }
        hostname ??= hostOf(item.text('url'))
        events.push({ ts, type: 'pageview', name: null, path })
      } else if (kind === 'event' || kind === 'goal') {
        const name = kind === 'goal' ? item.text('goalName') : item.text('eventAction')
        if (!name || !path) {
          skipped.push({ row: number, reason: `a ${kind} has no ${name ? 'url' : 'name'}` })
          continue
        }
        hostname ??= hostOf(item.text('url'))
        const props: Record<string, string> = {}
        if (kind === 'event') {
          for (const [key, field] of [
            ['category', 'eventCategory'],
            ['name', 'eventName'],
            ['value', 'eventValue'],
          ] as const) {
            const value = item.text(field)
            if (value !== null) props[key] = value
          }
        }
        events.push({ ts, type: 'goal', name, path, ...(Object.keys(props).length > 0 && { props }) })
      } else {
        skipped.push({ row: number, reason: `a ${kind} action is not supported` })
      }
    }
    if (events.length === 0) {
      skipped.push({ row: number, reason: 'the visit has no page views, events or goals' })
      return
    }
    const seconds = Number(row.text('visitDuration'))
    visits.push({
      id,
      visitor: row.text('visitorId') ?? id,
      startedAt: Math.min(...events.map((event) => event.ts)),
      durationMs: seconds > 0 ? Math.round(seconds * 1000) : null,
      hostname,
      referrer: referrerOf(row),
      utmSource: row.text('campaignSource'),
      utmMedium: row.text('campaignMedium'),
      utmCampaign: row.text('campaignName'),
      utmTerm: row.text('campaignKeyword'),
      utmContent: row.text('campaignContent'),
      country: normalizeCountry(row.text('countryCode') ?? row.text('country')),
      region: row.text('region'),
      city: row.text('city'),
      browser: normalizeBrowser(row.text('browserName')),
      os: normalizeOs(row.text('operatingSystem')),
      device: deviceOf(row.text('deviceType')),
      events,
    })
  })
  return { visits, skipped }
}

function hostOf(url: string | null): string | null {
  if (!url || !/^https?:\/\//i.test(url)) return null
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}
