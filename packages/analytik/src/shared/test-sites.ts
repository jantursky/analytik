/** Every site made by the test data generator lives under this domain, so the dashboard can tell them apart. */
export const TEST_SITE_DOMAIN = 'test.analytik.dev'

export const isTestDomain = (domain: string): boolean => domain.endsWith(`.${TEST_SITE_DOMAIN}`)

/** A kind of site in the generator's realistic mix: how much traffic it gets and how it earns. */
export interface TestSiteProfile {
  name: string
  visitorsPerDay: number
  /** Only the last few days have traffic, as for a site that just went live. */
  days?: number
  /** Multiplies its prices, for a shop with expensive plans. */
  priceScale?: number
  /** Tracking is paused on it. */
  paused?: boolean
}

/**
 * The realistic mix, in order: new test sites take these in turn, so even a few of them cover very different
 * dashboards, from an empty one to a busy shop.
 */
export const TEST_SITE_MIX: readonly TestSiteProfile[] = [
  { name: 'Busy shop', visitorsPerDay: 2500, priceScale: 3 },
  { name: 'Empty site', visitorsPerDay: 0 },
  { name: 'Company blog', visitorsPerDay: 300 },
  { name: 'Side project', visitorsPerDay: 25 },
  { name: 'Just launched', visitorsPerDay: 60, days: 3 },
  { name: 'Docs portal', visitorsPerDay: 900 },
  { name: 'Premium SaaS', visitorsPerDay: 150, priceScale: 40 },
  { name: 'Paused campaign', visitorsPerDay: 200, paused: true },
  { name: 'News magazine', visitorsPerDay: 6000 },
  { name: 'Personal site', visitorsPerDay: 8 },
]

/** The profile of the nth site in a realistic mix. */
export const mixProfile = (index: number): TestSiteProfile =>
  TEST_SITE_MIX[index % TEST_SITE_MIX.length] ?? { name: 'Test site', visitorsPerDay: 0 }

/** How many visits a realistic mix of `sites` sites over `days` days comes to, roughly. */
export function mixVisits(sites: number, days: number): number {
  let total = 0
  for (let index = 0; index < sites; index++) {
    const profile = mixProfile(index)
    total += profile.visitorsPerDay * Math.min(days, profile.days ?? days)
  }
  return total
}
