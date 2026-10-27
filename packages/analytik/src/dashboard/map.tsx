import { AnimatePresence, motion } from 'motion/react'

import type { Realtime } from '../shared/types'
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

interface Place {
  lon: number
  lat: number
  label: string
  count: number
  known: boolean
}

/** Groups locations by coordinates. Unknown locations (no country at 0,0) are kept but not placed. */
export function groupPlaces(locations: Realtime['locations']): Place[] {
  const places = new Map<string, Place>()
  for (const l of locations) {
    const known = !!l.country || l.lat !== 0 || l.lon !== 0
    const key = known ? `${l.lat},${l.lon}` : 'unknown'
    const label = [l.city, l.country && countryName(l.country)].filter(Boolean).join(', ') || 'Unknown location'
    const place = places.get(key) ?? { lon: l.lon, lat: l.lat, label, count: 0, known }
    place.count++
    places.set(key, place)
  }
  return [...places.values()].sort((a, b) => b.count - a.count)
}

export interface WorldMapProps {
  locations: Realtime['locations']
  /** Draws a globe centred on the visitors instead of a flat map. */
  globe?: boolean
}

/**
 * A dotted world map with a marker per visitor location. No tiles, no requests. New markers pop in with a ripple;
 * places nobody is at any more fade out.
 */
export function WorldMap({ locations, globe = false }: WorldMapProps) {
  const places = groupPlaces(locations)
  const placed = places.filter((p) => p.known)
  const center: LonLat | undefined = globe
    ? [placed.length ? placed.reduce((sum, p) => sum + p.lon, 0) / placed.length : 10, 20]
    : undefined
  const dots = landCells()
    .map((cell) => project(cell, center))
    .filter((point) => point != null)
    .map(([x, y]) => `M${x.toFixed(1)} ${y.toFixed(1)}h0`)
    .join('')
  const label = places.length
    ? `Visitor locations: ${places.map((p) => `${p.label} (${formatNumber(p.count)})`).join(', ')}`
    : 'Map with no visitor locations'

  return (
    <svg className="analytik-map" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={label}>
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
          const r = 1.6 + Math.sqrt(p.count)
          return (
            <g key={`${p.lat},${p.lon}`} transform={`translate(${point[0]} ${point[1]})`}>
              <motion.g
                className="analytik-map-marker"
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.4, transition: { duration: 0.8 } }}
                transition={{ type: 'spring', stiffness: 380, damping: 18 }}
              >
                <motion.circle
                  className="analytik-map-ripple"
                  r={r}
                  initial={{ opacity: 0.7, scale: 1 }}
                  animate={{ opacity: 0, scale: 5 }}
                  transition={{ duration: 1.6, ease: 'easeOut' }}
                />
                <circle className="analytik-map-halo" r={r * 2.2} />
                <circle r={r} />
              </motion.g>
            </g>
          )
        })}
      </AnimatePresence>
    </svg>
  )
}
