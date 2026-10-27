import { AnimatePresence, motion } from 'motion/react'
import { type KeyboardEvent, type MouseEvent, type PointerEvent, useRef, useState } from 'react'

import type { RealtimeVisit } from '../shared/types'
import { countryName, formatNumber } from './format'

/**
 * Land on a 3° grid from 84°N to 60°S, one bit per cell, rows of 120 cells from 180°W eastwards, base64.
 * Rasterised from Natural Earth's 1:110m land polygons (public domain).
 */
const LAND =
  'AAAAAf4P+AAAAAAAAAAAAAAAD+P//ADQAAAYAAAAAAAZL8f/+AAAACADgAAAAAAYvsB/+AAAAgH/9BAAA8ADy/g/4AAMADf///+Ah////64/gAB/z/f/////A////7wcBgDv///////+B///+DAMAAPf//////9cAIP/+DoAACLP/////+BAAAD//j8AACCf/////4DAAAB//7+AAF////////CAAAAf//wAAB////////AAAAAf//wAAB/9f////9AAAAAf//gAAF34f////5AAAAAf/+AAAHBz////9gAAAAAf/+AAAHCX////+iAAAAAP/8AAAD4A////8MAAAAAH/4AAAH+Y////+QAAAAAB8IAAAP/+9///+AAAAAAA8AAAAf//+P//8AAAAAAAYEAAAf//fx/fwAAAAAAAcggAAf//Pg8egAAAAAAAHgAAA///vA4fCAAAAAAAAwAAA///8AYHAAAAAAAAAR0AAf//+AYBAAAAAAAAAD8AAP//+AAABAAAAAAAAD/gAEP/8AAIMAAAAAAAAD/gAAH/4AAG4AAAAAAAAH/4AAH/wAACaIAAAAAAAH/+AAD/gAACAHAAAAAAAH//AAD/gAAAwDgAAAAAAD//AAD/gAAAAAAAAAAAAB/+AAD/yAAAAZAAAAAAAA/+AAD/mAAAB9gAAAAAAAf+AAD/EAAAD/gAAAAAAAf8AAB/MAAAP/wAAAAAAA/wAAB+AAAAP/4AAAAAAA/wAAB+AAAAP/4AAAAAAA/gAAA8AAAAH/4AAAAAAA/AAAAgAAAAEDwAAAAAAB+AAAAAAAAAABwCAAAAAB4AAAAAAAAAAAACAAAAAAwAAAAAAAAAAAAEAAAAABwAAAAAAAAAAAAIAAAAABgAAAAAAAAAAAAAAAAAABgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const STEP = 3
const COLUMNS = 360 / STEP
const TOP = 84
const WIDTH = 360
const HEIGHT = 144
const RADIUS = 68

type LonLat = readonly [number, number]

let land: LonLat[] | undefined

/** Centres of the land cells as [longitude, latitude]. */
export function landCells(): LonLat[] {
  if (land) return land
  const bytes = atob(LAND)
  land = []
  for (let i = 0; i < bytes.length * 8; i++) {
    if ((bytes.charCodeAt(i >> 3) >> (7 - (i & 7))) & 1) {
      land.push([-180 + ((i % COLUMNS) + 0.5) * STEP, TOP - (Math.floor(i / COLUMNS) + 0.5) * STEP])
    }
  }
  return land
}

const RAD = Math.PI / 180

/** Map coordinates in a 360×144 box: equirectangular, or an orthographic globe centred on `center`. */
export function project([lon, lat]: LonLat, center?: LonLat): [number, number] | null {
  if (!center) return [lon + 180, TOP - lat]
  const [l, p, l0, p0] = [lon * RAD, lat * RAD, center[0] * RAD, center[1] * RAD]
  const cos = Math.sin(p0) * Math.sin(p) + Math.cos(p0) * Math.cos(p) * Math.cos(l - l0)
  if (cos <= 0) return null
  const x = Math.cos(p) * Math.sin(l - l0)
  const y = Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(l - l0)
  return [WIDTH / 2 + RADIUS * x, HEIGHT / 2 - RADIUS * y]
}

export interface MapPlace {
  /** The coordinates, or `unknown`. */
  key: string
  lon: number
  lat: number
  label: string
  count: number
  known: boolean
  /** The visits there, newest first. */
  visits: RealtimeVisit[]
}

type Located = Pick<RealtimeVisit, 'lat' | 'lon' | 'country' | 'city'> & Partial<RealtimeVisit>

/** Groups visits by coordinates. Unknown locations (no country at 0,0) are kept but not placed. */
export function groupPlaces<T extends Located>(locations: readonly T[]): (MapPlace & { visits: T[] })[] {
  const places = new Map<string, MapPlace & { visits: T[] }>()
  for (const l of locations) {
    const known = !!l.country || l.lat !== 0 || l.lon !== 0
    const key = known ? `${l.lat},${l.lon}` : 'unknown'
    const label = [l.city, l.country && countryName(l.country)].filter(Boolean).join(', ') || 'Unknown location'
    const place = places.get(key) ?? { key, lon: l.lon, lat: l.lat, label, count: 0, known, visits: [] }
    place.count++
    place.visits.push(l)
    places.set(key, place)
  }
  return [...places.values()].sort((a, b) => b.count - a.count)
}

const visitorCount = (count: number): string => `${formatNumber(count)} ${count === 1 ? 'visitor' : 'visitors'}`

export interface WorldMapProps {
  locations: readonly Located[]
  /** Draws a globe centred on the visitors instead of a flat map; drag it, or use the arrow keys, to turn it. */
  globe?: boolean
  /** The place whose details are open; its marker is drawn as chosen. */
  selected?: string | null
  /** Makes markers buttons: hovering shows a tooltip, a click or Enter picks the place. */
  onSelect?: (key: string) => void
}

/** Degrees the globe turns per map unit dragged: a drag across the globe's radius turns it about a radian. */
const DEGREES_PER_UNIT = 180 / (Math.PI * RADIUS)
const KEY_STEP = 10
const MAX_TILT = 80

const clampLat = (lat: number): number => Math.max(-MAX_TILT, Math.min(MAX_TILT, lat))
const wrapLon = (lon: number): number => ((((lon + 180) % 360) + 360) % 360) - 180

/** Turns a globe by dragging (mouse, pen or touch) and by the arrow keys. */
function useTurn(auto: LonLat) {
  const [turned, setTurned] = useState<LonLat>()
  const drag = useRef<{ x: number; y: number; from: LonLat; scale: number }>(undefined)
  const center = turned ?? auto
  const turnTo = (lon: number, lat: number): void => setTurned([wrapLon(lon), clampLat(lat)])

  const onPointerDown = (event: PointerEvent<SVGSVGElement>): void => {
    // A press on a marker is a click on it, not the start of a drag.
    if (event.button !== 0 || (event.target as Element).closest('[data-place]')) return
    event.currentTarget.setPointerCapture(event.pointerId)
    // A map not laid out yet (width 0) counts as drawn at its own size.
    const scale = WIDTH / (event.currentTarget.getBoundingClientRect().width || WIDTH)
    drag.current = { x: event.clientX, y: event.clientY, from: center, scale }
  }
  const onPointerMove = (event: PointerEvent<SVGSVGElement>): void => {
    const start = drag.current
    if (!start) return
    const k = start.scale * DEGREES_PER_UNIT
    turnTo(start.from[0] - (event.clientX - start.x) * k, start.from[1] + (event.clientY - start.y) * k)
  }
  const onPointerUp = (): void => {
    drag.current = undefined
  }
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>): void => {
    if (event.target !== event.currentTarget) return
    const steps: Record<string, LonLat> = {
      ArrowLeft: [-KEY_STEP, 0],
      ArrowRight: [KEY_STEP, 0],
      ArrowUp: [0, KEY_STEP],
      ArrowDown: [0, -KEY_STEP],
    }
    const step = steps[event.key]
    if (!step) return
    event.preventDefault()
    turnTo(center[0] + step[0], center[1] + step[1])
  }
  return {
    center,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onKeyDown,
      // A drag should neither focus the map (and draw its ring) nor select text; the keyboard still reaches it.
      onMouseDown: (event: MouseEvent) => {
        if (!(event.target as Element).closest('[data-place]')) event.preventDefault()
      },
    },
  }
}

/**
 * A dotted world map with a marker per visitor location. No tiles, no requests. New markers pop in with a ripple;
 * places nobody is at any more fade out. With `onSelect`, markers show a tooltip and open details.
 */
export function WorldMap({ locations, globe = false, selected, onSelect }: WorldMapProps) {
  const places = groupPlaces(locations)
  const placed = places.filter((p) => p.known)
  const [hovered, setHovered] = useState<string>()
  // Until it is turned by hand, the globe faces the visitors.
  const turn = useTurn([placed.length ? placed.reduce((sum, p) => sum + p.lon, 0) / placed.length : 10, 20])
  const center = globe ? turn.center : undefined
  const dots = landCells()
    .map((cell) => project(cell, center))
    .filter((point) => point != null)
    .map(([x, y]) => `M${x.toFixed(1)} ${y.toFixed(1)}h0`)
    .join('')
  const label = places.length
    ? `Visitor locations: ${places.map((p) => `${p.label} (${formatNumber(p.count)})`).join(', ')}`
    : 'Map with no visitor locations'
  const tipPlace = placed.find((p) => p.key === hovered)
  const tipPoint = tipPlace && project([tipPlace.lon, tipPlace.lat], center)
  const tipPage = tipPlace?.visits.find((v) => v.page)?.page

  return (
    <div className="analytik-map-wrap">
      <svg
        className="analytik-map"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role={onSelect ? 'group' : 'img'}
        aria-label={globe ? `${label}. Drag, or use the arrow keys, to turn the globe.` : label}
        data-globe={globe ? '' : undefined}
        tabIndex={globe ? 0 : undefined}
        {...(globe ? turn.handlers : {})}
      >
        {globe ? (
          <circle className="analytik-map-grid" cx={WIDTH / 2} cy={HEIGHT / 2} r={RADIUS} />
        ) : (
          <path
            className="analytik-map-grid"
            d={[30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]
              .map((x) => `M${x} 0V${HEIGHT}`)
              .concat([24, 54, 84, 114].map((y) => `M0 ${y}H${WIDTH}`))
              .join('')}
          />
        )}
        <path className="analytik-map-land" d={dots} />
        <AnimatePresence>
          {placed.map((p) => {
            const point = project([p.lon, p.lat], center)
            if (!point) return null
            const r = Math.min(1.1 + Math.sqrt(p.count) * 0.55, 4.5)
            const pick = onSelect && (() => onSelect(p.key))
            return (
              <g
                key={p.key}
                transform={`translate(${point[0]} ${point[1]})`}
                data-place={p.key}
                data-selected={selected === p.key ? '' : undefined}
                role={pick && 'button'}
                tabIndex={pick && 0}
                aria-label={pick && `${p.label}: ${visitorCount(p.count)}. Show details.`}
                aria-pressed={pick && selected === p.key}
                onPointerEnter={() => setHovered(p.key)}
                onPointerLeave={() => setHovered(undefined)}
                onFocus={() => setHovered(p.key)}
                onBlur={() => setHovered(undefined)}
                onClick={pick}
                onKeyDown={(event) => {
                  if (pick && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault()
                    pick()
                  }
                }}
              >
                <motion.g
                  className="analytik-map-marker"
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{ opacity: 1, scale: hovered === p.key || selected === p.key ? 1.35 : 1 }}
                  exit={{ opacity: 0, scale: 0.4, transition: { duration: 0.8 } }}
                  transition={{ type: 'spring', stiffness: 380, damping: 18 }}
                >
                  <motion.circle
                    className="analytik-map-ripple"
                    r={r}
                    initial={{ opacity: 0.7, scale: 1 }}
                    animate={{ opacity: 0, scale: 4 }}
                    transition={{ duration: 1.6, ease: 'easeOut' }}
                  />
                  <circle className="analytik-map-halo" r={r * 1.8} />
                  {/* A bigger invisible target, so small markers are easy to point at. */}
                  <circle className="analytik-map-hit" r={Math.max(r * 2.2, 5)} />
                  <circle r={r} />
                </motion.g>
              </g>
            )
          })}
        </AnimatePresence>
      </svg>
      <AnimatePresence>
        {tipPlace && tipPoint && (
          <motion.div
            key={tipPlace.key}
            className="analytik-map-tip"
            role="tooltip"
            style={{ left: `${(tipPoint[0] / WIDTH) * 100}%`, top: `${(tipPoint[1] / HEIGHT) * 100}%` }}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            transition={{ duration: 0.15 }}
          >
            <strong>{tipPlace.label}</strong>
            <span>
              {visitorCount(tipPlace.count)}
              {tipPage && (
                <>
                  {' · '}
                  <span className="analytik-mono">{tipPage}</span>
                </>
              )}
            </span>
            {onSelect && <span className="analytik-map-tip-hint">Click for details</span>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
