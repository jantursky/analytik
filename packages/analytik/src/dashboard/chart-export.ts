// Loaded on demand by the chart's Export PNG button, so the encoder stays out of the first dashboard bundle.

/** Computed style properties that carry how a chart element looks; a standalone SVG has no stylesheet to read them. */
const LOOK = [
  'fill',
  'fill-opacity',
  'stop-color',
  'stop-opacity',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'text-anchor',
  'dominant-baseline',
  'display',
  'visibility',
] as const

const SCALE = 2
const MARGIN = 16
const TITLE_SIZE = 14

/** Copies the resolved look of `source` and everything below it onto `clone`, so CSS variables become plain values. */
function inlineLook(source: Element, clone: Element): void {
  const computed = getComputedStyle(source)
  const style = (clone as SVGElement).style
  for (const property of LOOK) {
    // A gradient is read back as a full address, which a standalone SVG cannot resolve; the id alone does.
    const value = computed.getPropertyValue(property).replace(/url\(["']?[^"')]*(#[^"')]+)["']?\)/g, 'url($1)')
    style.setProperty(property, value)
  }
  const from = [...source.children]
  const to = [...clone.children]
  from.forEach((child, i) => {
    const copy = to[i]
    if (copy) inlineLook(child, copy)
  })
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('The chart could not be drawn'))
    image.src = url
  })
}

/** The backdrop colour behind the chart: the first ancestor that has one, else white. */
function backdrop(element: Element): string {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const colour = getComputedStyle(node).backgroundColor
    if (colour && colour !== 'transparent' && colour !== 'rgba(0, 0, 0, 0)') return colour
  }
  return '#ffffff'
}

/** The chart inside `figure` as a PNG, on its own background with `title` above it. */
export async function chartPng(figure: Element, title: string): Promise<Blob> {
  const svg = figure.querySelector<SVGSVGElement>('svg.recharts-surface')
  if (!svg) throw new Error('There is no chart to export')
  const box = svg.getBoundingClientRect()
  const width = Math.max(1, Math.round(box.width || svg.width.baseVal.value))
  const height = Math.max(1, Math.round(box.height || svg.height.baseVal.value))

  const clone = svg.cloneNode(true) as SVGSVGElement
  inlineLook(svg, clone)
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  const markup = new XMLSerializer().serializeToString(clone)
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }))

  try {
    const image = await loadImage(url)
    const head = title ? TITLE_SIZE + MARGIN : 0
    const canvas = document.createElement('canvas')
    canvas.width = (width + MARGIN * 2) * SCALE
    canvas.height = (height + MARGIN * 2 + head) * SCALE
    const context = canvas.getContext('2d')
    if (!context) throw new Error('The chart could not be drawn')
    context.scale(SCALE, SCALE)
    context.fillStyle = backdrop(figure)
    context.fillRect(0, 0, canvas.width, canvas.height)
    if (title) {
      const text = getComputedStyle(figure)
      context.fillStyle = text.color
      context.font = `600 ${TITLE_SIZE}px ${text.fontFamily}`
      context.textBaseline = 'top'
      context.fillText(title, MARGIN, MARGIN)
    }
    context.drawImage(image, MARGIN, MARGIN + head, width, height)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The chart could not be saved'))), 'image/png'),
    )
  } finally {
    URL.revokeObjectURL(url)
  }
}
