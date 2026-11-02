import { randomId } from '../shared/ids'
import { DAY } from '../shared/time'
import type { Annotation } from '../shared/types'
import { AnalytikError, type Context } from './context'

export const MAX_NOTE_TEXT = 200
/** Notes returned with one chart; more than this on one range would be unreadable anyway. */
export const MAX_NOTES_IN_RANGE = 100
const MAX_NOTES_PER_SITE = 2000
const FAR_FUTURE = 366 * DAY

interface NoteRow {
  id: string
  ts: number
  text: string
  created_at: number
}

const toNote = (row: NoteRow): Annotation => ({
  id: row.id,
  ts: row.ts,
  text: row.text,
  createdAt: row.created_at,
})

// C0 and C1 control characters, which have no place in a note.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g

function parseText(value: unknown): string {
  if (typeof value !== 'string') throw new AnalytikError('text is required')
  const text = value.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim()
  if (!text) throw new AnalytikError('text is required')
  if (Array.from(text).length > MAX_NOTE_TEXT)
    throw new AnalytikError(`text must be at most ${MAX_NOTE_TEXT} characters`)
  return text
}

/** A unix-millisecond number or an ISO 8601 date or date-time; a bare date means the start of that day in UTC. */
function parseWhen(value: unknown, now: number): number {
  let at: number | null = null
  if (typeof value === 'number' && Number.isFinite(value)) at = Math.trunc(value)
  else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(T|$)/.test(value)) {
    const parsed = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value)
    at = Number.isNaN(parsed) ? null : parsed
  }
  if (at === null || at < 0 || at > now + FAR_FUTURE)
    throw new AnalytikError('ts must be a unix time in ms or an ISO 8601 date')
  return at
}

const COLUMNS = 'id, ts, text, created_at'

export async function createAnnotation(
  ctx: Context,
  siteId: string,
  input: Record<string, unknown>,
): Promise<Annotation> {
  const now = ctx.now()
  const text = parseText(input.text)
  const ts = input.ts === undefined ? now : parseWhen(input.ts, now)
  const [count] = await ctx.storage.query<{ n: number }>('SELECT COUNT(*) AS n FROM annotations WHERE site_id = ?', [
    siteId,
  ])
  if ((count?.n ?? 0) >= MAX_NOTES_PER_SITE) {
    throw new AnalytikError(`a site can have at most ${MAX_NOTES_PER_SITE} notes; delete old ones first`)
  }
  const id = `an_${randomId(12, ctx.random)}`
  await ctx.storage.run('INSERT INTO annotations (id, site_id, ts, text, created_at) VALUES (?, ?, ?, ?, ?)', [
    id,
    siteId,
    ts,
    text,
    now,
  ])
  return { id, ts, text, createdAt: now }
}

/** Changes the text, the date or both of a note; null when the site has no such note. */
export async function updateAnnotation(
  ctx: Context,
  siteId: string,
  id: string,
  input: Record<string, unknown>,
): Promise<Annotation | null> {
  const [row] = await ctx.storage.query<NoteRow>(`SELECT ${COLUMNS} FROM annotations WHERE site_id = ? AND id = ?`, [
    siteId,
    id,
  ])
  if (!row) return null
  const text = input.text === undefined ? row.text : parseText(input.text)
  const ts = input.ts === undefined ? row.ts : parseWhen(input.ts, ctx.now())
  await ctx.storage.run('UPDATE annotations SET text = ?, ts = ? WHERE site_id = ? AND id = ?', [text, ts, siteId, id])
  return { ...toNote(row), text, ts }
}

export async function deleteAnnotation(ctx: Context, siteId: string, id: string): Promise<boolean> {
  const { changes } = await ctx.storage.run('DELETE FROM annotations WHERE site_id = ? AND id = ?', [siteId, id])
  return changes > 0
}

/** The notes dated in `[from, to)`, oldest first: one read of the `(site_id, ts)` index. */
export async function annotationsBetween(
  ctx: Context,
  siteId: string,
  from: number,
  to: number,
): Promise<Annotation[]> {
  const rows = await ctx.storage.query<NoteRow>(
    `SELECT ${COLUMNS} FROM annotations WHERE site_id = ? AND ts >= ? AND ts < ? ORDER BY ts, id LIMIT ${MAX_NOTES_IN_RANGE}`,
    [siteId, from, to],
  )
  return rows.map(toNote)
}
