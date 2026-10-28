import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { Dashboard } from '../src/dashboard/index'
import type { ImportSummary } from '../src/shared/import/types'
import { fakeApi } from './dashboard-fixtures'
import { choose, press, selectTrigger, waitFor } from './dashboard-helpers'
import { actAsync, byText, click, render, settled } from './react-render'

const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures/import', name), 'utf8')
const file = (name: string, text: string) => new File([text], name, { type: 'text/csv' })

async function open(api = fakeApi()) {
  const result = await render(<Dashboard api="/api" fetcher={api.fetcher} view="settings" />)
  await settled()
  await click(byText(result.container, 'Data', '.analytik-settings-nav button'))
  await settled()
  return { ...result, api }
}

/** Puts files in the file input and fires change, as the browser does when someone picks them. */
async function pick(container: Element, files: File[]) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')
  if (!input) throw new Error('no file input')
  Object.defineProperty(input, 'files', { value: files, configurable: true })
  await actAsync(() => input.dispatchEvent(new Event('change', { bubbles: true })))
  for (let i = 0; i < 10; i++) await settled()
}

const umami = () => [
  file('events.csv', fixture('umami-events.csv')),
  file('sessions.csv', fixture('umami-sessions.csv')),
  file('event-data.csv', fixture('umami-event-data.csv')),
]

const stats = (container: Element) =>
  [...container.querySelectorAll('.analytik-import-stats > div')].map((el) => el.textContent)
const importButton = (container: Element) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent.startsWith('Import '))

afterEach(() => {
  vi.useRealTimers()
})

describe('Import data', () => {
  it('previews the files and stores nothing until it is confirmed', async () => {
    const { container, api } = await open()
    await pick(container, umami())
    expect(stats(container)).toEqual([
      'Visits3',
      'Events5',
      'First visitMar 10, 2026',
      'Last visitMar 11, 2026',
      'Skipped rows4',
    ])
    expect(container.querySelector('.analytik-import-note')?.textContent).toContain('already has 30 visits')
    expect(container.querySelectorAll('.analytik-table tbody tr')).toHaveLength(3)
    expect(importButton(container)?.textContent).toBe('Import 3 visits')

    await click(byText(container, 'Cancel', 'button'))
    expect(container.querySelector('input[type="file"]')).not.toBeNull()
    expect(api.find('POST', '/sites/site_1/import')).toHaveLength(0)
  })

  it('imports in chunks, shows what was stored and what was skipped, and reloads the list', async () => {
    const imports: ImportSummary[] = []
    const api = fakeApi({
      'GET /sites/:id/imports': () => imports,
      'POST /sites/:id/import': ({ body }) => {
        const visits = (body as { visits: { events: unknown[] }[] }).visits
        imports.splice(0, imports.length, { source: 'umami', visits: 3, events: 5, from: 1, to: 2 })
        return {
          visits: visits.length,
          events: visits.reduce((sum, v) => sum + v.events.length, 0),
          existing: { visits: 0, events: 0 },
          tooOld: { visits: 0, events: 0 },
        }
      },
    })
    const { container } = await open(api)
    await pick(container, umami())
    await click(importButton(container))
    for (let i = 0; i < 5; i++) await settled()

    const posts = api.find('POST', '/sites/site_1/import')
    expect(posts).toHaveLength(1)
    expect(posts[0]?.body).toMatchObject({ source: 'umami' })
    const rows = [...container.querySelectorAll('.analytik-table tbody tr')].map((tr) => tr.textContent)
    expect(rows).toEqual(['Imported35', 'Already imported00', 'Older than the retention limit00'])
    expect(container.querySelector('.analytik-import-skipped')?.textContent).toContain(
      'Row 5: event_type 3 is not supported',
    )
    expect(byText(container, 'Imported data', 'h2')).toBeDefined()
    expect(container.querySelector('.analytik-import-list')?.textContent).toContain('Umami')

    await click(byText(container, 'Done', 'button'))
    expect(container.querySelector('input[type="file"]')).not.toBeNull()
  })

  it('can be stopped between chunks and says how to finish', async () => {
    const header = 'created_at,session_id,visit_id,url_path,event_type'
    const lines = Array.from(
      { length: 450 },
      (_, i) => `2026-03-10T09:${String(i % 60).padStart(2, '0')}:00Z,s${i},v${i},/p,1`,
    )
    let release: () => void = () => undefined
    let first = true
    const api = fakeApi({
      'POST /sites/:id/import': ({ body }) => {
        const count = (body as { visits: unknown[] }).visits.length
        const answer = {
          visits: count,
          events: count,
          existing: { visits: 0, events: 0 },
          tooOld: { visits: 0, events: 0 },
        }
        if (!first) return answer
        first = false
        return new Promise((resolve) => {
          release = () => resolve(answer)
        })
      },
    })
    const { container } = await open(api)
    await pick(container, [file('events.csv', [header, ...lines].join('\n'))])
    await click(importButton(container))
    await settled()
    expect(container.querySelector('progress')?.getAttribute('max')).toBe('450')
    await click(byText(container, 'Cancel', 'button'))
    release()
    for (let i = 0; i < 5; i++) await settled()

    expect(api.find('POST', '/sites/site_1/import')).toHaveLength(1)
    expect(container.querySelector('.analytik-import-note')?.textContent).toContain('Stopped after 200 of 450 visits')
  })

  it('names a file that is not the chosen source and does not offer to import', async () => {
    const { container } = await open()
    await pick(container, [file('sa.csv', fixture('simple-analytics.csv'))])
    expect(container.textContent).toContain('The file sa.csv is not an Umami export')
    expect(importButton(container)).toBeUndefined()
    await pick(container, [file('empty.csv', 'created_at,session_id,url_path\n')])
    expect(container.textContent).toContain('No Umami events found')
  })

  it('removes an import after confirming with the numbers', async () => {
    const imports: ImportSummary[] = [{ source: 'simple-analytics', visits: 1200, events: 3400, from: 1, to: 2 }]
    const api = fakeApi({
      'GET /sites/:id/imports': () => imports,
      'DELETE /sites/:id/imports/:source': () => {
        imports.length = 0
        return { visits: 1200, events: 3400, visitors: 900 }
      },
    })
    const { container } = await open(api)
    expect(container.querySelector('.analytik-import-list')?.textContent).toContain('Simple Analytics')
    await click(byText(container.querySelector('.analytik-import-list')!, 'Remove', 'button'))
    await settled()
    const dialog = document.body.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain('This deletes 1,200 visits and 3,400 events imported from Simple Analytics')
    expect(api.find('DELETE', '/sites/site_1/imports')).toHaveLength(0)
    await click(byText(dialog!, 'Remove import', 'button'))
    for (let i = 0; i < 3; i++) await settled()
    expect(api.find('DELETE', '/sites/site_1/imports/simple-analytics')).toHaveLength(1)
    expect(container.querySelector('.analytik-import-list')).toBeNull()
  })
})

describe('Import from the sites overview', () => {
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!
  async function openDialog(api = fakeApi()) {
    const result = await render(<Dashboard api="/api" fetcher={api.fetcher} view="sites" />)
    await settled()
    await click(byText(result.container, 'Add website', 'button'))
    await settled()
    await press(byText(document.body, 'Import from another tool', '[role="menuitem"]'))
    return { ...result, api }
  }

  async function drop(files: File[]) {
    const zone = dialog().querySelector('.analytik-dropzone')
    if (!zone) throw new Error('no drop zone')
    const event = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: { files } })
    await actAsync(() => zone.dispatchEvent(event))
    // Reading the files is asynchronous: wait for the preview or the error note.
    await waitFor(() => dialog().querySelector('.analytik-import-stats, [role="alert"], .analytik-error'))
    await settled()
  }

  it('picks a platform, takes dropped files, previews them and imports into a new site', async () => {
    const { api } = await openDialog()
    expect([...dialog().querySelectorAll('.analytik-source-choice')].map((b) => b.textContent)).toEqual([
      'Umami',
      'Simple Analytics',
    ])
    await press(byText(dialog(), 'Umami', 'button'))
    await drop(umami())
    expect(stats(dialog())).toContain('Visits3')
    expect(dialog().querySelectorAll('.analytik-table tbody tr')).toHaveLength(3)
    expect(dialog().querySelector('.analytik-import-note')?.textContent).toContain(
      'Import 3 visits and 5 events from Umami into',
    )
    expect(api.find('POST', '/sites/').filter((r) => r.path.endsWith('/import'))).toHaveLength(0)
    await press(importButton(dialog()))
    expect(api.find('POST', '/sites').filter((r) => r.path === '/sites')).toHaveLength(1)
    expect(api.find('POST', '/sites/').filter((r) => r.path.endsWith('/import'))).toHaveLength(1)
    expect(dialog().textContent).toContain('Imported')
  })

  it('shows a file error, then accepts the right file', async () => {
    const { api } = await openDialog()
    await press(byText(dialog(), 'Simple Analytics', 'button'))
    await drop([file('wrong.csv', 'a,b\n1,2\n')])
    expect(dialog().textContent).toContain('lacks the column')
    await drop([file('sa.csv', fixture('simple-analytics.csv'))])
    await waitFor(() => dialog().querySelector('.analytik-import-stats'))
    expect(stats(dialog())).toContain('Visits3')
    expect(api.find('POST', '/sites').filter((r) => r.path === '/sites')).toHaveLength(0)
  })

  it('imports into an existing site, goes back and opens the site afterwards', async () => {
    const { api } = await openDialog()
    await press(byText(dialog(), 'Umami', 'button'))
    await press(byText(dialog(), 'Change', 'button'))
    expect(dialog().querySelectorAll('.analytik-source-choice')).toHaveLength(2)
    await press(byText(dialog(), 'Umami', 'button'))
    await drop(umami())
    await choose(selectTrigger(dialog(), 'Import into'), 'Example')
    await settled()
    expect(dialog().textContent).toContain('into Example?')
    await press(byText(dialog(), 'Back', 'button'))
    expect(dialog().querySelector('.analytik-source-choice')).not.toBeNull()
    await press(byText(dialog(), 'Umami', 'button'))
    await drop(umami())
    await choose(selectTrigger(dialog(), 'Import into'), 'Example')
    await press(importButton(dialog()))
    expect(api.find('POST', '/sites').filter((r) => r.path === '/sites')).toHaveLength(0)
    expect(api.find('POST', '/sites/site_1/import')).toHaveLength(1)
    await press(byText(dialog(), 'Open site', 'button'))
    await settled()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
})
