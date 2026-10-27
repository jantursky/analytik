import { randomId } from '../shared/ids'
import { mixProfile, mixVisits, TEST_SITE_DOMAIN, type TestSiteProfile } from '../shared/test-sites'
import type { TestDataResult } from '../shared/types'
import { AnalytikError, type Context } from './context'
import { deleteSite, listSites, requireSite } from './sites'

/** Sites made by the generator start with this, so they can be told apart and removed together. */
export const TEST_SITE_PREFIX = 'debug-'

/** One call writes at most this many visits; more would hold the request open for minutes. */
export const MAX_TEST_VISITS = 1_000_000

const MAX_SITES = 20
const MAX_DAYS = 730
const MAX_PER_DAY = 100_000
const MAX_PRICE_SCALE = 100_000
const CURRENCY = /^[A-Z]{3}$/

function whole(value: unknown, name: string, low: number, high: number, fallback: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value < low || value > high) {
    throw new AnalytikError(`${name} must be a whole number from ${low} to ${high}`)
  }
  return value
}

/**
 * Fills the database with made-up traffic and payments, for trying the dashboard with many sites, long histories
 * and large numbers. Writes into `siteId` when given, otherwise into `sites` new test sites. With `mix`, the new
 * sites differ the way real ones do (an empty one, a quiet blog, a busy shop, a paused one) and `visitorsPerDay` and
 * `priceScale` don't apply. Each call uses fresh ids, so calling it twice doubles the data.
 */
export async function generateTestData(ctx: Context, input: Record<string, unknown>): Promise<TestDataResult> {
  // Zero days or zero visits make empty sites, for trying the dashboard before any data arrives.
  const days = whole(input.days, 'days', 0, MAX_DAYS, 30)
  const visitorsPerDay = whole(input.visitorsPerDay, 'visitorsPerDay', 0, MAX_PER_DAY, 500)
  const count = whole(input.sites, 'sites', 1, MAX_SITES, 1)
  const priceScale = input.priceScale ?? 1
  if (typeof priceScale !== 'number' || !(priceScale > 0) || priceScale > MAX_PRICE_SCALE) {
    throw new AnalytikError(`priceScale must be a number above 0 and up to ${MAX_PRICE_SCALE}`)
  }
  const currency = input.currency ?? 'USD'
  if (typeof currency !== 'string' || !CURRENCY.test(currency)) {
    throw new AnalytikError('currency must be a three-letter code such as USD')
  }
  const existing = typeof input.siteId === 'string' ? await requireSite(ctx, input.siteId) : null
  const targets = existing ? 1 : count
  const mix = input.mix === true && !existing
  if ((mix ? mixVisits(targets, days) : targets * days * visitorsPerDay) > MAX_TEST_VISITS) {
    throw new AnalytikError(`at most ${MAX_TEST_VISITS.toLocaleString('en-US')} visits per call; ask for fewer`)
  }

  // Loaded on demand: the generator's tables of made-up places and pages aren't needed to serve traffic.
  const { seedDemo } = await import('../migrate/seed')
  const started = Date.now()
  const result: TestDataResult = {
    sites: [],
    counts: { visitors: 0, sessions: 0, events: 0, payments: 0 },
    durationMs: 0,
  }
  for (let index = 0; index < targets; index++) {
    const suffix = randomId(6, ctx.random)
    const profile: TestSiteProfile = mix ? mixProfile(index) : { name: 'Test site', visitorsPerDay, priceScale }
    const site = existing ?? {
      id: `${TEST_SITE_PREFIX}${suffix}`,
      name: `${profile.name} ${suffix}`,
      domain: `${suffix}.${TEST_SITE_DOMAIN}`,
      currency,
    }
    const seeded = await seedDemo(ctx.storage, {
      // Ids derive from the seed, so a fresh one per call keeps new rows from colliding with earlier ones.
      seed: new DataView(ctx.random(4).buffer).getUint32(0),
      now: ctx.now(),
      days: Math.min(days, profile.days ?? days),
      visitorsPerDay: profile.visitorsPerDay,
      priceScale: profile.priceScale ?? 1,
      siteId: site.id,
      domain: site.domain,
      name: site.name,
      currency: site.currency,
    })
    if (profile.paused) await ctx.storage.run('UPDATE sites SET paused = ? WHERE id = ?', [1, site.id])
    result.sites.push({ id: site.id, name: site.name })
    for (const key of ['visitors', 'sessions', 'events', 'payments'] as const) result.counts[key] += seeded.counts[key]
  }
  result.durationMs = Date.now() - started
  return result
}

/** Removes every site the generator made, with all of its data. Sites added by hand stay. */
export async function deleteTestSites(ctx: Context): Promise<{ deleted: number }> {
  const sites = (await listSites(ctx)).filter((site) => site.id.startsWith(TEST_SITE_PREFIX))
  for (const site of sites) await deleteSite(ctx, site.id)
  return { deleted: sites.length }
}
