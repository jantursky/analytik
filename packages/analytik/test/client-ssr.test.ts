// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { createClient } from '../src/client/index'

describe('createClient without window', () => {
  it('returns a no-op client', async () => {
    const client = createClient({ site: 'site_1' })
    expect(typeof window).toBe('undefined')
    expect(() => {
      client.track('x')
      client.revenue('x', 1)
      client.identify({ userId: 'u' })
      client.pageview()
      client.consent()
      client.withdrawConsent()
      client.optOut()
      client.optIn()
      client.destroy()
    }).not.toThrow()
    expect(await client.attribution()).toBeNull()
    expect('ids' in client).toBe(false)
  })
})
