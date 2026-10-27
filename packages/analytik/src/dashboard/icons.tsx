// 16px stroke icons, decorative: the button around each one carries the accessible name.
const PATHS = {
  plus: 'M8 3v10M3 8h10',
  prev: 'M10 3 5 8l5 5',
  next: 'M6 3l5 5-5 5',
  down: 'M4 6l4 4 4-4',
  check: 'M3.5 8.5l3 3 6-7',
  calendar: 'M3 4.5h10v8.5H3zM3 7.5h10M5.5 2.5v3M10.5 2.5v3',
  refresh: 'M13 8a5 5 0 1 1-1.5-3.6M13 2.5V5h-2.5',
  close: 'M4 4l8 8M12 4l-8 8',
  sound: 'M3 6h2.5L9 3v10L5.5 10H3zM11.5 5.5a3.5 3.5 0 0 1 0 5',
  muted: 'M3 6h2.5L9 3v10L5.5 10H3zM11 6l3 4M14 6l-3 4',
  globe: 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2M2 8h12M8 2c-2.2 2.6-2.2 9.4 0 12M8 2c2.2 2.6 2.2 9.4 0 12',
  flat: 'M2 4h12v8H2zM2 8h12M6 4v8M10 4v8',
  theme: 'M8 2a6 6 0 1 0 0 12zM8 2a6 6 0 0 1 0 12',
  expand: 'M3 6V3h3M10 3h3v3M13 10v3h-3M6 13H3v-3',
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="analytik-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  )
}
