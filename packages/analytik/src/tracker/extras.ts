/*! analytik extras | MIT | opt-in: file downloads and not-found pages, sent through window.analytik */

const DEFAULT_EXTENSIONS = ['pdf', 'zip', 'dmg', 'exe', 'csv', 'xlsx', 'docx', 'pptx', 'mp3', 'mp4']

type Global = ((command: string, ...args: unknown[]) => unknown) & { q?: unknown[][] }

const w = window as Window & { analytik?: Global }
const script = document.currentScript
const attr = script?.getAttribute('data-extensions')
const extensions = new Set(
  (attr ?? DEFAULT_EXTENSIONS.join(' ')).split(/[\s,]+/).map((ext) => ext.replace(/^\./, '').toLowerCase()),
)

// Loaded before the core: queue the calls on the stub the core replays when it starts (see tracker.ts).
if (!w.analytik) {
  const queue: unknown[][] = []
  const stub = ((...args: unknown[]) => void queue.push(args)) as Global
  stub.q = queue
  w.analytik = stub
}

const track = (name: string, props?: Record<string, string>): void => {
  w.analytik?.('track', name, props)
}

// Capture phase, like the core: a link's own handlers cannot stop the event before it is seen.
function onClick(event: Event): void {
  const link = event.target instanceof Element ? event.target.closest('a[href]') : null
  if (!link) return
  let url: URL
  try {
    url = new URL(link.getAttribute('href') ?? '', location.href)
  } catch {
    return
  }
  const dot = url.pathname.lastIndexOf('.')
  if (dot < 0 || !extensions.has(url.pathname.slice(dot + 1).toLowerCase())) return
  track('download', { file: url.pathname })
}

function notFound(): void {
  if (!document.querySelector('meta[name="analytik-404"],body[data-analytik-404]')) return
  let from: string | undefined
  try {
    const ref = new URL(document.referrer)
    from = ref.origin + ref.pathname
  } catch {
    // No referrer, or an unparseable one.
  }
  track('404', from ? { from } : undefined)
}

document.addEventListener('click', onClick, true)
document.addEventListener('auxclick', onClick, true)
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', notFound, { once: true })
else notFound()

export {}
