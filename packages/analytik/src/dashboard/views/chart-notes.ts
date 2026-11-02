import { parseDate } from '../../shared/time'
import type { TimeseriesPoint } from '../../shared/types'
import type { ChartNote, NoteActions } from '../charts'
import { useDashboard } from '../context'

/** The day (`YYYY-MM-DD`) a moment falls on in a time zone. */
const dayIn = (ts: number, timeZone: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ts)

/**
 * The notes carried by a chart's points, and, for an admin, what to do with them. A note is dated by the day it was
 * written for, read in the site's time zone, which is how the chart's own days are cut. `reload` loads the chart again
 * after a change.
 */
export function useChartNotes(points: TimeseriesPoint[], reload: () => void) {
  const { client, site, readOnly } = useDashboard()
  const notes: ChartNote[] = points.flatMap((p) =>
    (p.notes ?? []).map((n) => ({ id: n.id, ts: p.ts, at: n.ts, text: n.text })),
  )
  const when = (day: string): number => {
    const at = parseDate(day, site.timezone)
    if (at === null) throw new Error('Pick a date')
    return at
  }
  const actions: NoteActions | undefined = readOnly
    ? undefined
    : {
        add: (text, day) => client.createAnnotation(site.id, { text, ts: when(day) }),
        edit: (id, text, day) => client.updateAnnotation(site.id, id, { text, ts: when(day) }),
        remove: (id) => client.deleteAnnotation(site.id, id),
        dayOf: (ts) => dayIn(ts, site.timezone),
      }
  return { notes, noteActions: actions, onNotesChanged: reload }
}
