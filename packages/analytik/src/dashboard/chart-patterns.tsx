// Loaded with the chart chunk: the fills Dither and ASCII draw in place of a gradient.
import type { ChartStyle } from './preferences'

/** The 4×4 ordered-dither (Bayer) thresholds; a cell is filled where its threshold is below the density. */
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
]
const CELL = 2
const TILE = 4 * CELL

/** How many pattern families there are; a series takes the family of its position, so neighbours differ. */
export const FAMILIES = 4

type Cell = [number, number]

/** The filled cells of a 4×4 tile. `strong` is the denser tone, used for bars; the soft one fills areas. */
export function ditherCells(family: number, strong: boolean): Cell[] {
  const cells: Cell[] = []
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const filled = [
        // Dots from the Bayer matrix.
        () => (BAYER[y]?.[x] ?? 16) < (strong ? 11 : 5),
        // Diagonal lines.
        () => (x + y) % (strong ? 2 : 4) === 0,
        // Crossed diagonals.
        () => (x + y) % 4 === 0 || (x - y + 4) % 4 === 0 || (strong && x === 0),
        // Sparse grid dots.
        () => (strong ? x % 2 === 1 && y % 2 === 1 : x === 1 && y === 1),
      ][family % FAMILIES]
      if (filled?.()) cells.push([x, y])
    }
  }
  return cells
}

/** The character that stands for a family in ASCII: a light one for areas, a heavy one for bars. */
const GLYPHS: readonly (readonly [string, string])[] = [
  ['.', '#'],
  ['/', 'X'],
  ['+', '%'],
  [':', '@'],
]
export const glyph = (family: number, strong: boolean): string => GLYPHS[family % FAMILIES]?.[strong ? 1 : 0] ?? '.'

export interface PatternSpec {
  /** Names the pattern within one chart. */
  key: string
  colour: string
  family: number
  strong: boolean
}

/** The id a plot uses in `url(#…)` for a spec's pattern. */
export const patternId = (id: string, key: string): string => `${id}-${key}`

/** `<pattern>` elements for a chart's `<defs>`, in the chosen style; nothing in the default style. */
export function ChartPatterns({ style, id, specs }: { style: ChartStyle; id: string; specs: PatternSpec[] }) {
  if (style === 'default') return null
  return specs.map(({ key, colour, family, strong }) =>
    style === 'dither' ? (
      <pattern key={key} id={patternId(id, key)} width={TILE} height={TILE} patternUnits="userSpaceOnUse">
        {ditherCells(family, strong).map(([x, y]) => (
          <rect
            key={`${x}-${y}`}
            x={x * CELL}
            y={y * CELL}
            width={CELL}
            height={CELL}
            fill={colour}
            shapeRendering="crispEdges"
          />
        ))}
      </pattern>
    ) : (
      <pattern key={key} id={patternId(id, key)} width={6} height={9} patternUnits="userSpaceOnUse">
        <text x={0} y={7} fontSize={9} fontFamily="var(--analytik-font-mono)" fill={colour}>
          {glyph(family, strong)}
        </text>
      </pattern>
    ),
  )
}
