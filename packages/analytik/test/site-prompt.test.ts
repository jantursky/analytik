import { describe, expect, it } from 'vitest'

import { SITE_TARGETS, sitePrompt } from '../src/dashboard/site-prompt'

const options = {
  host: 'https://stats.example.org/',
  siteId: 'site_1',
  mode: 'strict' as const,
  requireInteraction: true,
  allowLocalhost: false,
  autoOutbound: true,
}

describe('site integration prompt', () => {
  it.each(SITE_TARGETS.map((target) => [target.id, target.label] as const))('is complete for %s', (id, label) => {
    const prompt = sitePrompt(id, options)
    expect(prompt).toContain(`# Add Analytik tracking to your ${label} site`)
    expect(prompt).toContain('https://stats.example.org')
    expect(prompt).toContain('site_1')
    expect(prompt).toContain('## Verify')
  })

  it('follows the privacy mode and the script options', () => {
    const prompt = sitePrompt('html', {
      ...options,
      host: 'not a url',
      siteId: ' ',
      mode: 'persistent',
      requireInteraction: false,
      allowLocalhost: true,
      autoOutbound: false,
    })
    expect(prompt).toContain('https://analytics.example.com/analytik.js')
    expect(prompt).toContain('data-site="my-site"')
    expect(prompt).toContain('data-mode="persistent"')
    expect(prompt).toContain('data-require-interaction="false"')
    expect(prompt).toContain('data-allow-localhost="true"')
    expect(prompt).toContain('data-auto-outbound="false"')
    expect(sitePrompt('html', { ...options, host: 'ftp://x.example' })).toContain('https://analytics.example.com')
  })
})
