import { describe, expect, it, vi } from 'vitest'

import { AreaChart } from '../src/dashboard/charts'
import { groupPlaces, WorldMap } from '../src/dashboard/map'
import { waitFor } from './dashboard-helpers'
import { key as press, render } from './react-render'

describe('chart note markers', () => {
  const points = [10, 40, 20, 30].map((value, i) => ({ ts: i, value }))
  const notes = [{ id: 'an_1', ts: 1, at: 1, text: 'Launch' }]
  const chart = () => (
    <AreaChart points={points} label="Visitors" formatValue={String} formatTime={(ts) => `day ${ts}`} notes={notes} />
  )

  it.each(['Enter', ' '])('opens the note when %j is pressed on its marker', async (name) => {
    const { container } = await render(chart())
    const marker = await waitFor(() => container.querySelector('.analytik-note'))
    expect(marker.getAttribute('role')).toBe('button')
    expect(marker.getAttribute('tabindex')).toBe('0')
    expect(marker.getAttribute('aria-label')).toBe('day 1: Launch')
    expect(container.querySelector('.analytik-notes-panel')).toBeNull()
    await press(marker, name)
    expect(container.querySelector('.analytik-notes-panel')?.textContent).toContain('Launch')
  })

  it('ignores other keys', async () => {
    const { container } = await render(chart())
    const marker = await waitFor(() => container.querySelector('.analytik-note'))
    await press(marker, 'a')
    expect(container.querySelector('.analytik-notes-panel')).toBeNull()
  })
})

describe('map places', () => {
  const visit = (lat: number, lon: number, city: string, country: string) => ({ lat, lon, city, country })
  const locations = [
    visit(48.1, 17.1, 'Bratislava', 'SK'),
    visit(48.1, 17.1, 'Bratislava', 'SK'),
    visit(50.1, 14.4, 'Prague', 'CZ'),
    visit(52.5, 13.4, 'Berlin', 'DE'),
  ]

  it('names every place with its count for a screen reader', async () => {
    const { container } = await render(<WorldMap locations={locations} />)
    const label = container.querySelector('svg')?.getAttribute('aria-label') ?? ''
    const places = groupPlaces(locations)
    expect(places).toHaveLength(3)
    for (const place of places) expect(label).toContain(`${place.label} (${place.count})`)
  })

  it('gives every place a keyboard reachable marker that Enter and Space pick', async () => {
    const onSelect = vi.fn()
    const { container } = await render(<WorldMap locations={locations} onSelect={onSelect} />)
    const markers = await waitFor(() => {
      const found = [...container.querySelectorAll('[data-place]')]
      return found.length === 3 ? found : null
    })
    for (const marker of markers) {
      expect(marker.getAttribute('role')).toBe('button')
      expect(marker.getAttribute('tabindex')).toBe('0')
    }
    expect(markers.map((m) => m.getAttribute('aria-label'))).toEqual(
      groupPlaces(locations).map((p) => expect.stringContaining(p.label) as string),
    )
    await press(markers[0], 'Enter')
    await press(markers[1], ' ')
    expect(onSelect.mock.calls.map((c: unknown[]) => c[0])).toEqual(
      groupPlaces(locations)
        .slice(0, 2)
        .map((p) => p.key),
    )
  })

  it('lists every place as text for a screen reader', async () => {
    const { container } = await render(<WorldMap locations={locations} />)
    const rows = [...container.querySelectorAll('ul.analytik-sr-only li')].map((li) => li.textContent)
    expect(rows).toHaveLength(3)
    groupPlaces(locations).forEach((place, i) => expect(rows[i]).toContain(place.label))
  })
})
