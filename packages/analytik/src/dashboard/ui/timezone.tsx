import { Combobox } from './combobox'

export interface TimeZoneInfo {
  zone: string
  /** `UTC+05:30`, `UTC` for zero. */
  offset: string
  /** The offset in minutes, for sorting. */
  minutes: number
  /** "Central European Time"; the zone itself when the engine has no name for it. */
  name: string
  /** The time there now, e.g. `14:32`. */
  time: string
}

export const localTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone

/** Every IANA zone the browser knows, the local one first. */
export function timeZones(): string[] {
  const local = localTimeZone()
  let all: string[] = []
  try {
    all = Intl.supportedValuesOf('timeZone')
  } catch {
    // Older engines: offer the local zone only.
  }
  return [local, ...all.filter((zone) => zone !== local)]
}

const part = (zone: string, now: Date, timeZoneName: 'longOffset' | 'long'): string =>
  new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName })
    .formatToParts(now)
    .find((p) => p.type === 'timeZoneName')?.value ?? ''

/** The offset, long name and current time of a zone at `now`. */
export function describeTimeZone(zone: string, now = new Date()): TimeZoneInfo {
  try {
    const gmt = part(zone, now, 'longOffset')
    const match = /GMT([+-])(\d{2}):(\d{2})/.exec(gmt)
    const minutes = match ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) : 0
    const name = part(zone, now, 'long')
    return {
      zone,
      offset: match && minutes ? `UTC${match[1]}${match[2]}:${match[3]}` : 'UTC',
      minutes,
      name: name.startsWith('GMT') ? zone : name,
      time: new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit' }).format(now),
    }
  } catch {
    return { zone, offset: '', minutes: 0, name: zone, time: '' }
  }
}

/** `America/Argentina/Buenos_Aires` → `Buenos Aires, America`. */
export function zoneLabel(zone: string): string {
  const parts = zone.split('/').map((p) => p.replace(/_/g, ' '))
  return parts.length > 1 ? `${parts.at(-1) ?? zone}, ${parts[0] ?? ''}` : (parts[0] ?? zone)
}

/** A searchable time zone list: city, region, UTC offset, the zone's name and the time there now. */
export function TimeZoneSelect({
  label,
  value,
  onChange,
  hint,
}: {
  label: string
  value: string
  onChange: (zone: string) => void
  hint?: string
}) {
  const now = new Date()
  const local = localTimeZone()
  const zones = timeZones()
  const options = zones.includes(value) ? zones : [value, ...zones]
  return (
    <Combobox
      label={label}
      value={value}
      options={options}
      onChange={onChange}
      hint={hint}
      placeholder="Search a city or UTC offset"
      describe={(zone) => {
        const info = describeTimeZone(zone, now)
        return {
          // Typing matches the city, the region, the raw zone or the offset.
          label: `${zoneLabel(zone)} (${info.offset})`,
          detail: [info.name, `${info.time} now`, zone === local ? 'your time zone' : ''].filter(Boolean).join(' · '),
          leading: (
            <span className="analytik-zone-tile" aria-hidden="true">
              <strong>{info.time}</strong>
              <span>{info.offset.replace('UTC', '') || '±0'}</span>
            </span>
          ),
        }
      }}
    />
  )
}
