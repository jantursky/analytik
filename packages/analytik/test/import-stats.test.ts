import { describe, expect, it } from 'vitest'

import { createContext } from '../src/server/context'
import { importVisits } from '../src/server/import/core'
import { requireSite } from '../src/server/sites'
import type { ImportVisit } from '../src/shared/import/types'
import type { Overview } from '../src/shared/types'
import { START, testServer } from './helpers/server'

function visit(id: string, durationMs: number | null): ImportVisit {
  return {
    id,
    visitor: id,
    durationMs,
    events: [
      { ts: START - 3_600_000, type: 'pageview', name: null, path: '/' },
      { ts: START - 3_500_000, type: 'pageview', name: null, path: '/a' },
    ],
  }
}

describe('stats over imported visits', () => {
  it('leaves visits without a known duration out of the average visit duration', async () => {
    const server = await testServer()
    const { site } = await server.createSite()
    const ctx = createContext({ storage: server.storage, now: () => START })
    const record = await requireSite(ctx, site.id)
    const from = '2026-03-16'
    const read = async () => {
      const overview = await server.adminJson<{ overview?: Overview } & Overview>(
        `/sites/${site.id}/overview?from=${from}&to=${from}`,
      )
      return overview.avgDurationMs.value
    }

    await importVisits(ctx, record, 'umami', [visit('a', 60_000), visit('b', 120_000)])
    expect(await read()).toBe(90_000)

    // Two more visits from a source that has no duration: the average does not move, the visit counts do.
    await importVisits(ctx, record, 'simple-analytics', [visit('c', null), visit('d', null)])
    expect(await read()).toBe(90_000)
    const overview = await server.adminJson<Overview>(`/sites/${site.id}/overview?from=${from}&to=${from}`)
    expect(overview.sessions.value).toBe(4)
  })
})
