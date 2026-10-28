import { isImportSource, type ImportEvent, type ImportSource, type ImportVisit } from '../../shared/import/types'
import { clip } from '../../shared/url'
import { AnalytikError } from '../context'

/** Visits per request. With the event limit below, one request stays small enough for a Worker. */
export const MAX_VISITS = 200
export const MAX_EVENTS = 1000
/** Body size of an import request, larger than the other admin routes because a chunk carries many rows. */
export const IMPORT_BODY_LIMIT = 1024 * 1024

/** 2000-01-01: nothing a web analytics tool recorded is older, and it catches seconds mistaken for milliseconds. */
const EARLIEST = Date.UTC(2000, 0, 1)
const DAY = 24 * 60 * 60 * 1000

const fail = (message: string): never => {
  throw new AnalytikError(message)
}

const record = (value: unknown, where: string): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail(`${where} must be an object`)

function text(value: unknown, where: string, max: number, required = false): string | null {
  if (value === undefined || value === null || value === '') return required ? fail(`${where} is required`) : null
  if (typeof value !== 'string') return fail(`${where} must be a string`)
  return clip(value, max) ?? (required ? fail(`${where} is required`) : null)
}

function time(value: unknown, where: string, now: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < EARLIEST || value > now + DAY) {
    return fail(`${where} must be unix milliseconds`)
  }
  return Math.round(value)
}

function event(raw: unknown, where: string, now: number): ImportEvent {
  const row = record(raw, where)
  const type = row.type
  if (type !== 'pageview' && type !== 'goal') return fail(`${where}.type must be pageview or goal`)
  const name = text(row.name, `${where}.name`, 100, type === 'goal')
  const id = text(row.id, `${where}.id`, 500)
  const props = row.props === undefined || row.props === null ? null : record(row.props, `${where}.props`)
  return {
    ...(id && { id }),
    ts: time(row.ts, `${where}.ts`, now),
    type,
    name: type === 'goal' ? name : null,
    path: text(row.path, `${where}.path`, 500, true) ?? '/',
    ...(props && { props: props as ImportEvent['props'] }),
  }
}

function visit(raw: unknown, where: string, now: number): ImportVisit {
  const row = record(raw, where)
  if (!Array.isArray(row.events) || row.events.length === 0) return fail(`${where}.events must be a list of events`)
  const duration = row.durationMs
  if (
    duration !== undefined &&
    duration !== null &&
    (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0)
  ) {
    return fail(`${where}.durationMs must be a number of milliseconds`)
  }
  const optional = (key: string, max = 255) => text(row[key], `${where}.${key}`, max)
  return {
    id: text(row.id, `${where}.id`, 500, true) ?? '',
    visitor: text(row.visitor, `${where}.visitor`, 500, true) ?? '',
    ...(row.startedAt !== undefined && { startedAt: time(row.startedAt, `${where}.startedAt`, now) }),
    durationMs: typeof duration === 'number' ? duration : null,
    hostname: optional('hostname', 255),
    referrer: optional('referrer', 2000),
    utmSource: optional('utmSource', 100),
    utmMedium: optional('utmMedium', 100),
    utmCampaign: optional('utmCampaign', 200),
    utmTerm: optional('utmTerm', 200),
    utmContent: optional('utmContent', 200),
    country: optional('country', 2),
    region: optional('region', 50),
    city: optional('city', 50),
    browser: optional('browser', 50),
    os: optional('os', 50),
    device: optional('device', 20),
    events: (row.events as unknown[]).map((item, index) => event(item, `${where}.events[${index}]`, now)),
  }
}

/** Checks one import request and rebuilds it from known fields only, so nothing unexpected reaches storage. */
export function parseImportBody(
  body: Record<string, unknown>,
  now: number,
): { source: ImportSource; visits: ImportVisit[] } {
  if (!isImportSource(body.source))
    return fail('source must be umami, simple-analytics, matomo, goatcounter, ga4 or posthog')
  if (!Array.isArray(body.visits) || body.visits.length === 0) return fail('visits must be a list of visits')
  if (body.visits.length > MAX_VISITS) throw new AnalytikError(`send at most ${MAX_VISITS} visits per request`, 413)
  const visits = (body.visits as unknown[]).map((item, index) => visit(item, `visits[${index}]`, now))
  if (visits.reduce((sum, item) => sum + item.events.length, 0) > MAX_EVENTS) {
    throw new AnalytikError(`send at most ${MAX_EVENTS} events per request`, 413)
  }
  return { source: body.source, visits }
}
