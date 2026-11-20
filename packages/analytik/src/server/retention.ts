import type { Context } from './context'
import { listSites } from './sites'
import { DAY } from '../shared/time'
import { type ChunkedPurge, purgeChunked } from './stats/purge'

/** What one scheduled retention run removed, per site, and whether it got to the end. */
export interface RetentionRun {
  /** False when the time budget ran out; call again to continue. */
  done: boolean
  /** The sites that have a retention period, with the rows removed from each. */
  sites: Record<string, ChunkedPurge>
}

/**
 * Deletes data older than each site's `retentionDays`, in bounded steps, within `ctx.retentionBudgetMs` altogether.
 * A site without a retention period is left alone. Safe to run as often as you like: finished work is not repeated.
 */
export async function runRetention(ctx: Context): Promise<RetentionRun> {
  const started = Date.now()
  const run: RetentionRun = { done: true, sites: {} }
  for (const site of await listSites(ctx)) {
    if (!site.retentionDays) continue
    const left = ctx.retentionBudgetMs - (Date.now() - started)
    if (left <= 0) {
      run.done = false
      break
    }
    const purged = await purgeChunked(ctx, site.id, ctx.now() - site.retentionDays * DAY, left)
    run.sites[site.id] = purged
    if (!purged.done) run.done = false
  }
  return run
}
