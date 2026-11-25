import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Global = ((...args: unknown[]) => unknown) & { q?: unknown[][] }
type Listener = [string, EventListenerOrEventListenerObject, boolean | AddEventListenerOptions | undefined]

const w = window as Window & { analytik?: Global }
const added: Listener[] = []

/** Loads a fresh copy of analytik-extras.js, optionally as if it were the script tag with `attrs`. */
async function load(attrs: Record<string, string> = {}): Promise<void> {
  const tag = document.createElement('script')
  for (const [name, value] of Object.entries(attrs)) tag.setAttribute(name, value)
  Object.defineProperty(document, 'currentScript', { configurable: true, get: () => tag })
  await import('../src/tracker/extras')
  Object.defineProperty(document, 'currentScript', { configurable: true, get: () => null })
}

function click(href: string, target = 'a'): void {
  const link = document.createElement(target)
  link.setAttribute('href', href)
  document.body.append(link)
  link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  link.remove()
}

beforeEach(() => {
  delete w.analytik
  document.body.innerHTML = ''
  document.head.innerHTML = ''
  document.body.removeAttribute('data-analytik-404')
  // Each load adds document listeners; remember them so one test's configuration cannot leak into the next.
  const original = document.addEventListener.bind(document)
  vi.spyOn(document, 'addEventListener').mockImplementation((type, fn, opts) => {
    added.push([type, fn, opts])
    original(type, fn, opts)
  })
  Object.defineProperty(document, 'referrer', { configurable: true, value: '' })
})

afterEach(() => {
  for (const [type, fn, opts] of added.splice(0)) document.removeEventListener(type, fn, opts)
  vi.restoreAllMocks()
  vi.resetModules()
  delete w.analytik
})

describe('analytik-extras.js', () => {
  it('queues calls until the core is ready, so the core replays them', async () => {
    await load()
    click('/files/guide.pdf')
    expect(w.analytik?.q).toEqual([['track', 'download', { file: '/files/guide.pdf' }]])
    expect((w.analytik as { track?: unknown } | undefined)?.track).toBeUndefined()
  })

  it('sends a download for a link to a listed file, with the path and no query string', async () => {
    const spy = vi.fn()
    w.analytik = spy
    await load()
    click('/files/guide.pdf?token=abc#top')
    expect(spy).toHaveBeenCalledWith('track', 'download', { file: '/files/guide.pdf' })
  })

  it('matches the extension case-insensitively', async () => {
    const spy = vi.fn()
    w.analytik = spy
    await load()
    click('/files/Report.PDF')
    expect(spy).toHaveBeenCalledWith('track', 'download', { file: '/files/Report.PDF' })
  })

  it('sends nothing for a link to a page', async () => {
    const spy = vi.fn()
    w.analytik = spy
    await load()
    click('/pricing')
    expect(spy).not.toHaveBeenCalled()
  })

  it('takes the list from data-extensions instead of the defaults', async () => {
    const spy = vi.fn()
    w.analytik = spy
    await load({ 'data-extensions': '.epub, odt' })
    click('/books/a.epub')
    click('/files/guide.pdf')
    expect(spy).toHaveBeenCalledWith('track', 'download', { file: '/books/a.epub' })
    expect(spy).not.toHaveBeenCalledWith('track', 'download', expect.objectContaining({ file: '/files/guide.pdf' }))
  })

  it('sends one 404 with the referrer origin and path when the page is marked', async () => {
    const spy = vi.fn()
    w.analytik = spy
    Object.defineProperty(document, 'referrer', { configurable: true, value: 'https://news.example/post?utm=1' })
    document.head.innerHTML = '<meta name="analytik-404">'
    await load()
    expect(spy.mock.calls.filter((call) => call[1] === '404')).toEqual([
      ['track', '404', { from: 'https://news.example/post' }],
    ])
  })

  it('marks a page with a body attribute too, and sends no props without a referrer', async () => {
    const spy = vi.fn()
    w.analytik = spy
    document.body.setAttribute('data-analytik-404', '')
    await load()
    expect(spy).toHaveBeenCalledWith('track', '404', undefined)
  })

  it('sends nothing on a page that is not marked as not found', async () => {
    const spy = vi.fn()
    w.analytik = spy
    await load()
    expect(spy).not.toHaveBeenCalledWith('track', '404', expect.anything())
    expect(spy).not.toHaveBeenCalledWith('track', '404', undefined)
  })
})
