import { afterEach, describe, expect, it, vi } from 'vitest'

import { Dashboard, type DashboardView } from '../src/dashboard/index'
import type { Annotation, TimeseriesPoint } from '../src/shared/types'
import { fakeApi, timeseries } from './dashboard-fixtures'
import { waitFor } from './dashboard-helpers'
import { byText, click, fill, render, settled, submit } from './react-render'

const note = (id: string, day: number, text: string): Annotation => ({
  id,
  ts: Date.UTC(2026, 9, day, 9),
  text,
  createdAt: 1,
})

/** A fake API whose chart carries these notes, and which keeps what is added, changed and deleted. */
function withNotes(...initial: Annotation[]) {
  const stored = [...initial]
  const api = fakeApi({
    'GET /sites/:id/timeseries': () =>
      timeseries.map<TimeseriesPoint>((point) => {
        const own = stored.filter((n) => n.ts >= point.ts && n.ts < point.ts + 86_400_000)
        return own.length ? { ...point, notes: own } : point
      }),
    'POST /sites/:id/annotations': ({ body }) => {
      const input = body as { text: string; ts: number }
      const created = { id: `an_${stored.length + 1}`, ts: input.ts, text: input.text, createdAt: 2 }
      stored.push(created)
      return created
    },
    'PATCH /sites/:id/annotations/:nid': ({ path, body }) => {
      const found = stored.find((n) => path.endsWith(`/${n.id}`))
      if (!found) return Response.json({ error: 'note not found' }, { status: 404 })
      Object.assign(found, body)
      return found
    },
    'DELETE /sites/:id/annotations/:nid': ({ path }) => {
      stored.splice(
        stored.findIndex((n) => path.endsWith(`/${n.id}`)),
        1,
      )
      return { ok: true }
    },
  })
  return { api, stored }
}

async function open(api = fakeApi(), props: { share?: string; view?: DashboardView } = {}) {
  const result = await render(<Dashboard api="/api" fetcher={api.fetcher} siteId="site_1" {...props} />)
  await settled()
  // The chart is a lazy chunk: wait for it rather than for a fixed number of ticks, which a slow machine outruns.
  await waitFor(() => result.container.querySelector('.recharts-surface'))
  await settled()
  return { ...result, api }
}

const flags = (container: Element) => [...container.querySelectorAll('.analytik-note')]
const panel = (container: Element) => container.querySelector('.analytik-notes-panel')

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('notes on the chart', () => {
  it('flags a note on the chart and shows its text on hover and in the panel', async () => {
    const { api } = withNotes(note('an_a', 21, 'Launch'))
    const { container } = await open(api)
    expect(flags(container)).toHaveLength(1)
    expect(flags(container)[0]?.querySelector('title')?.textContent).toContain('Launch')
    await click(flags(container)[0])
    expect(panel(container)?.textContent).toContain('Launch')
    await click(byText(container, 'Close', '.analytik-notes-panel button'))
    expect(panel(container)).toBeNull()
  })

  it('draws nothing when there are no notes', async () => {
    const { container } = await open(withNotes().api)
    expect(flags(container)).toHaveLength(0)
    expect(container.querySelector('[data-testid="chart-notes"]')).toBeNull()
  })

  it('merges flags that sit close together into one with a count', async () => {
    const { api } = withNotes(note('an_a', 21, 'One'), note('an_b', 21, 'Two'), note('an_c', 23, 'Three'))
    const { container } = await open(api)
    // Two notes on one day share a flag; the third is on another day.
    const counts = flags(container).map((f) => f.querySelector('.analytik-note-count')?.textContent ?? '')
    expect(counts.sort()).toEqual(['', '2'])
    await click(flags(container).find((f) => f.querySelector('.analytik-note-count')))
    expect(
      [...container.querySelectorAll('.analytik-notes-list li')].map(
        (li) => li.querySelector('.analytik-note-text')?.textContent,
      ),
    ).toEqual(['One', 'Two'])
  })

  it('adds a note for a day, and the chart loads again to show it', async () => {
    const { api, stored } = withNotes()
    const { container } = await open(api)
    await click(byText(container, 'Add note', 'button'))
    await fill(container.querySelector('.analytik-note-form input:not([type="date"])'), 'Launch')
    await fill(container.querySelector('.analytik-note-form input[type="date"]'), '2026-10-21')
    await submit(container.querySelector('.analytik-note-form'))
    await settled()
    expect(api.find('POST', '/sites/site_1/annotations')[0]?.body).toEqual({
      text: 'Launch',
      ts: Date.UTC(2026, 9, 21),
    })
    expect(stored).toHaveLength(1)
    expect(panel(container)).toBeNull()
    expect(flags(container)).toHaveLength(1)
  })

  it('edits and deletes a note', async () => {
    const { api, stored } = withNotes(note('an_a', 21, 'Launch'))
    const { container } = await open(api)
    await click(flags(container)[0])
    await click(byText(container, 'Edit', '.analytik-notes-panel button'))
    expect(container.querySelector<HTMLInputElement>('.analytik-note-form input')?.value).toBe('Launch')
    expect(container.querySelector<HTMLInputElement>('input[type="date"]')?.value).toBe('2026-10-21')
    await fill(container.querySelector('.analytik-note-form input:not([type="date"])'), 'Launch v2')
    await fill(container.querySelector('input[type="date"]'), '2026-10-22')
    await submit(container.querySelector('.analytik-note-form'))
    await settled()
    expect(stored[0]).toMatchObject({ text: 'Launch v2', ts: Date.UTC(2026, 9, 22) })
    expect(api.find('PATCH', '/sites/site_1/annotations/an_a')).toHaveLength(1)

    await click(flags(container)[0])
    await click(byText(container, 'Delete', '.analytik-notes-panel button'))
    await settled()
    expect(stored).toHaveLength(0)
    expect(panel(container)).toBeNull()
    expect(flags(container)).toHaveLength(0)
  })

  it('cancels the form without saving', async () => {
    const { api } = withNotes()
    const { container } = await open(api)
    await click(byText(container, 'Add note', 'button'))
    await click(byText(container, 'Cancel', '.analytik-note-form button'))
    expect(panel(container)).toBeNull()
    expect(api.find('POST', '/sites/site_1/annotations')).toHaveLength(0)
  })

  it('shows the server error and keeps the form open', async () => {
    const failing = fakeApi({
      'GET /sites/:id/timeseries': () => timeseries,
      'POST /sites/:id/annotations': () =>
        Response.json({ error: 'text must be at most 200 characters' }, { status: 400 }),
    })
    const { container } = await open(failing)
    await click(byText(container, 'Add note', 'button'))
    await fill(container.querySelector('.analytik-note-form input:not([type="date"])'), 'x')
    await submit(container.querySelector('.analytik-note-form'))
    await settled()
    expect(container.querySelector('.analytik-note-form [role="alert"]')?.textContent).toBe(
      'text must be at most 200 characters',
    )
  })

  it('shows the same notes on the Revenue chart', async () => {
    const { api } = withNotes(note('an_a', 21, 'Launch'))
    const { container } = await open(api, { view: 'revenue' })
    expect(flags(container)).toHaveLength(1)
  })

  it('on a shared dashboard shows the notes but offers no way to change them', async () => {
    const { api } = withNotes(note('an_a', 21, 'Launch'))
    const { container } = await open(api, { share: 'good-token-1234567890abcdef' })
    expect(flags(container)).toHaveLength(1)
    expect(byText(container, 'Add note', 'button')).toBeUndefined()
    await click(flags(container)[0])
    expect(panel(container)?.textContent).toContain('Launch')
    expect(byText(container, 'Edit', '.analytik-notes-panel button')).toBeUndefined()
    expect(byText(container, 'Delete', '.analytik-notes-panel button')).toBeUndefined()
  })
})

describe('Export PNG', () => {
  it('saves the chart through the lazy encoder', async () => {
    const png = new Blob(['png'], { type: 'image/png' })
    vi.doMock('../src/dashboard/chart-export', () => ({ chartPng: vi.fn(() => Promise.resolve(png)) }))
    const saved: Blob[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => (saved.push(blob as Blob), 'blob:x'))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const { container } = await open(withNotes().api)
    await clickButton(container, 'Export PNG')
    await waitFor(() => saved[0])
    expect(saved[0]).toBe(png)
    expect(click).toHaveBeenCalled()
    vi.doUnmock('../src/dashboard/chart-export')
  })

  it('says so when the chart cannot be drawn', async () => {
    vi.doMock('../src/dashboard/chart-export', () => ({ chartPng: () => Promise.reject(new Error('no canvas')) }))
    const { container } = await open(withNotes().api)
    await clickButton(container, 'Export PNG')
    await waitFor(() => document.querySelector('.analytik-toast, [role="status"]')?.textContent.includes('no canvas'))
    vi.doUnmock('../src/dashboard/chart-export')
  })
})

const clickButton = (container: Element, label: string) => click(byText(container, label, 'button'))
