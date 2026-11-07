import type { JourneyLink, JourneyNode, JourneysResult } from '../../shared/types'

export const FLOW_WIDTH = 920
export const FLOW_HEIGHT = 380
export const NODE_WIDTH = 12
const NODE_GAP = 10
const MIN_NODE_HEIGHT = 3
const LABEL_ROOM = 190

export interface PlacedNode extends JourneyNode {
  x: number
  y: number
  height: number
  /** Where the label sits: right of the bar, or left of it for the last column. */
  side: 'right' | 'left'
}

export interface PlacedLink extends JourneyLink {
  /** The curve between the two bars, drawn with a stroke as wide as the flow. */
  path: string
  width: number
}

export interface FlowLayout {
  nodes: PlacedNode[]
  links: PlacedLink[]
  steps: number[]
}

/**
 * Places the journey as a Sankey diagram: one column per step, bars as tall as their sessions, and curves between them
 * as wide as the sessions that went that way. Columns share one scale so heights can be compared across the diagram.
 */
export function layoutFlow(result: Pick<JourneysResult, 'nodes' | 'links'>): FlowLayout {
  const steps = [...new Set(result.nodes.map((node) => node.step))].sort((a, b) => a - b)
  const columns = new Map<number, JourneyNode[]>(steps.map((step) => [step, []]))
  for (const node of result.nodes) columns.get(node.step)?.push(node)

  // One scale for all columns: the tallest one, with its gaps, fills the height.
  let scale = Infinity
  for (const nodes of columns.values()) {
    const total = nodes.reduce((sum, node) => sum + node.sessions, 0)
    const room = FLOW_HEIGHT - Math.max(0, nodes.length - 1) * NODE_GAP
    if (total > 0) scale = Math.min(scale, room / total)
  }
  if (!Number.isFinite(scale)) scale = 0

  const span = steps.length > 1 ? (FLOW_WIDTH - NODE_WIDTH - LABEL_ROOM) / (steps.length - 1) : 0
  const placed = new Map<string, PlacedNode>()
  steps.forEach((step, column) => {
    let y = 0
    for (const node of columns.get(step) ?? []) {
      const height = Math.max(MIN_NODE_HEIGHT, node.sessions * scale)
      placed.set(node.id, {
        ...node,
        x: column * span,
        y,
        height,
        side: column === steps.length - 1 && steps.length > 1 ? 'left' : 'right',
      })
      y += height + NODE_GAP
    }
  })

  // Each link takes the next free slice of its source bar and of its target bar, ordered by where the other end is.
  const used = new Map<string, { out: number; in: number }>()
  const take = (id: string, side: 'out' | 'in', size: number): number => {
    const state = used.get(id) ?? { out: 0, in: 0 }
    const at = state[side]
    state[side] += size
    used.set(id, state)
    return at
  }
  const order = (id: string): number => placed.get(id)?.y ?? 0
  const links: PlacedLink[] = []
  const bySource = [...result.links].sort((a, b) => order(a.to) - order(b.to) || b.sessions - a.sessions)
  const outgoing = new Map<string, number>()
  for (const link of bySource) outgoing.set(`${link.from}>${link.to}`, take(link.from, 'out', link.sessions * scale))
  const byTarget = [...result.links].sort((a, b) => order(a.from) - order(b.from) || b.sessions - a.sessions)
  for (const link of byTarget) {
    const from = placed.get(link.from)
    const to = placed.get(link.to)
    if (!from || !to) continue
    const width = Math.max(1, link.sessions * scale)
    const y0 = from.y + (outgoing.get(`${link.from}>${link.to}`) ?? 0) + width / 2
    const y1 = to.y + take(link.to, 'in', link.sessions * scale) + width / 2
    const x0 = from.x + NODE_WIDTH
    const x1 = to.x
    const mid = (x0 + x1) / 2
    links.push({
      ...link,
      width,
      path: `M${round(x0)},${round(y0)}C${round(mid)},${round(y0)} ${round(mid)},${round(y1)} ${round(x1)},${round(y1)}`,
    })
  }
  return { nodes: [...placed.values()], links, steps }
}

const round = (value: number): number => Math.round(value * 10) / 10
