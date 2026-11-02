import { describe, expect, it } from 'vitest'

import { chartPng } from '../../src/dashboard/chart-export'

/** The first bytes of every PNG file. */
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47]

describe('chart PNG export in a real browser', () => {
  it('draws a chart that colours itself with CSS variables into a non-empty PNG', async () => {
    const figure = document.createElement('figure')
    figure.style.cssText = '--c: rgb(200, 30, 30); background: rgb(250, 250, 250); font-family: sans-serif'
    figure.innerHTML = `<svg class="recharts-surface" width="320" height="120" viewBox="0 0 320 120">
      <path d="M0 100 L80 40 L160 70 L320 10" fill="none" style="stroke: var(--c); stroke-width: 3"></path>
      <text x="10" y="20" style="fill: var(--c); font-size: 12px">Peak</text></svg>`
    document.body.append(figure)
    try {
      const blob = await chartPng(figure, 'Visitors')
      expect(blob.type).toBe('image/png')
      expect(blob.size).toBeGreaterThan(500)
      const bytes = new Uint8Array(await blob.arrayBuffer())
      expect([...bytes.slice(0, 4)]).toEqual(SIGNATURE)
    } finally {
      figure.remove()
    }
  })

  it('refuses a figure without a chart', async () => {
    await expect(chartPng(document.createElement('figure'), 'x')).rejects.toThrow('no chart')
  })
})
