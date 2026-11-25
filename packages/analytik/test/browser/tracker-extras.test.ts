import { afterEach, describe, expect, it } from 'vitest'

import type { TrackerPayload } from '../../src/shared/types'

interface Received {
  path: string
  type: string
  body: TrackerPayload
}

const frames: HTMLIFrameElement[] = []

afterEach(() => {
  for (const frame of frames.splice(0)) frame.remove()
})

/** Opens the fake site with the core and the extras script; `path` picks the page (`/missing`, `/dnt/`). */
async function openPage(path = '', extra: Record<string, string> = {}): Promise<{ run: string; doc: Document }> {
  const run = Math.random().toString(36).slice(2)
  const frame = document.createElement('iframe')
  frame.style.width = '800px'
  frame.style.height = '400px'
  const attrs = JSON.stringify({
    'data-allow-localhost': '',
    'data-site': 'site_1',
    'data-require-interaction': 'false',
    ...extra,
  })
  frame.src = `/__analytik/page/${run}${path}?${new URLSearchParams({ attrs }).toString()}`
  const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }))
  document.body.appendChild(frame)
  frames.push(frame)
  await loaded
  const doc = frame.contentDocument!
  await waitFor(() => typeof (frame.contentWindow as Window & { analytik?: unknown }).analytik === 'function')
  return { run, doc }
}

async function waitFor(check: () => boolean | Promise<boolean>, timeout = 8000): Promise<void> {
  const end = Date.now() + timeout
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

async function received(run: string): Promise<Received[]> {
  const response = await fetch(`/__analytik/run/${run}/received`)
  return JSON.parse(await response.text()) as Received[]
}

/** Waits until at least `count` requests arrived, then returns them. */
async function collect(run: string, count: number): Promise<Received[]> {
  let list: Received[] = []
  await waitFor(async () => (list = await received(run)).length >= count)
  return list
}

const goals = (list: Received[]): TrackerPayload[] => list.map((r) => r.body).filter((b) => b.t === 'goal')

describe('analytik-extras.js in a real browser', () => {
  it('sends a download goal with the file path and no query, beside the core pageview', async () => {
    const { run, doc } = await openPage()
    await collect(run, 1)
    doc.getElementById('pdf')!.click()
    const [download] = goals(await collect(run, 2))
    expect(download).toMatchObject({ n: 'download', p: { file: '/files/guide.pdf' } })
  })

  it('sends one 404 goal on a page marked as not found', async () => {
    const { run } = await openPage('/missing')
    await collect(run, 1)
    const found = await collect(run, 2)
    expect(goals(found).filter((g) => g.n === '404')).toHaveLength(1)
  })

  it('sends nothing at all for an automated browser, download or not-found page', async () => {
    const { run, doc } = await openPage('/bot/')
    doc.getElementById('pdf')!.click()
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(await received(run)).toEqual([])
  })

  it('sends a download without visitor or session ids when Do Not Track is on in persistent mode', async () => {
    // The core withholds the cookie ids under Do Not Track; the anonymous goal is still sent, as for any goal.
    const { run, doc } = await openPage('/dnt/', { 'data-mode': 'persistent' })
    await collect(run, 1)
    doc.getElementById('pdf')!.click()
    const [download] = goals(await collect(run, 2))
    expect(download).toMatchObject({ n: 'download', p: { file: '/files/guide.pdf' } })
    expect(download?.vid).toBeUndefined()
    expect(download?.sid).toBeUndefined()
  })
})
