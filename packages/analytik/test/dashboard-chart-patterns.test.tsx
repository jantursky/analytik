import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ChartPatterns, ditherCells, FAMILIES, glyph, patternId } from '../src/dashboard/chart-patterns'

describe('dither tiles', () => {
  it('are denser for bars than for areas, in every family', () => {
    for (let family = 0; family < FAMILIES; family++) {
      expect(ditherCells(family, true).length).toBeGreaterThan(ditherCells(family, false).length)
      expect(ditherCells(family, false).length).toBeGreaterThan(0)
    }
  })

  it('differ from one family to the next, so series can be told apart without colour', () => {
    const shapes = Array.from({ length: FAMILIES }, (_, family) => JSON.stringify(ditherCells(family, false)))
    expect(new Set(shapes).size).toBe(FAMILIES)
    const bars = Array.from({ length: FAMILIES }, (_, family) => JSON.stringify(ditherCells(family, true)))
    expect(new Set(bars).size).toBe(FAMILIES)
  })

  it('stay inside the 4 by 4 tile', () => {
    for (let family = 0; family < FAMILIES; family++) {
      for (const [x, y] of ditherCells(family, true)) {
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThan(4)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThan(4)
      }
    }
  })
})

describe('ascii glyphs', () => {
  it('are different per family and heavier for bars', () => {
    expect(new Set(Array.from({ length: FAMILIES }, (_, f) => glyph(f, false))).size).toBe(FAMILIES)
    expect(new Set(Array.from({ length: FAMILIES }, (_, f) => glyph(f, true))).size).toBe(FAMILIES)
    expect(glyph(0, true)).not.toBe(glyph(0, false))
  })
})

describe('ChartPatterns', () => {
  const specs = [
    { key: 'area', colour: 'red', family: 0, strong: false },
    { key: 'bars', colour: 'blue', family: 1, strong: true },
  ]
  const render = (style: 'default' | 'dither' | 'ascii') =>
    renderToStaticMarkup(
      <svg>
        <defs>
          <ChartPatterns style={style} id="c1" specs={specs} />
        </defs>
      </svg>,
    )

  it('draws nothing in the default style', () => {
    expect(render('default')).not.toContain('pattern')
  })

  it('draws one tile of squares per spec in Dither', () => {
    const html = render('dither')
    expect(html).toContain(`id="${patternId('c1', 'area')}"`)
    expect(html).toContain(`id="${patternId('c1', 'bars')}"`)
    expect(html).toContain('<rect')
    expect(html).not.toContain('<text')
  })

  it('draws one tile of a character per spec in ASCII', () => {
    const html = render('ascii')
    expect(html.match(/<text/g)).toHaveLength(2)
    expect(html).toContain('>.<')
    expect(html).toContain('>X<')
  })
})
