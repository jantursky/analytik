import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { chartPng } from '../../src/dashboard/chart-export'
import { ChartPatterns } from '../../src/dashboard/chart-patterns'

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

  it.each(['dither', 'ascii'] as const)('keeps the %s pattern in the image', async (style) => {
    const defs = renderToStaticMarkup(
      createElement(ChartPatterns, {
        style,
        id: 't',
        specs: [{ key: 'a', colour: 'rgb(0, 0, 0)', family: 0, strong: false }],
      }),
    )
    const figure = document.createElement('figure')
    figure.style.cssText = 'background: rgb(255, 255, 255); --analytik-font-mono: monospace'
    figure.innerHTML = `<svg class="recharts-surface" width="120" height="80" viewBox="0 0 120 80">
      <defs>${defs}</defs><rect x="0" y="0" width="120" height="80" style="fill: url(#t-a)"></rect></svg>`
    document.body.append(figure)
    try {
      const blob = await chartPng(figure, '')
      const bitmap = await createImageBitmap(blob)
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('no canvas')
      context.drawImage(bitmap, 0, 0)
      // Inside the chart (past the margin) a solid fill would be one colour; a pattern mixes ink and paper.
      const { data } = context.getImageData(40, 40, 60, 60)
      const tones = new Set<number>()
      for (let i = 0; i < data.length; i += 4) tones.add(data[i] ?? 0)
      expect(tones.size).toBeGreaterThan(1)
      expect(Math.min(...tones)).toBeLessThan(128)
      expect(Math.max(...tones)).toBeGreaterThan(200)
    } finally {
      figure.remove()
    }
  })

  it('refuses a figure without a chart', async () => {
    await expect(chartPng(document.createElement('figure'), 'x')).rejects.toThrow('no chart')
  })
})
