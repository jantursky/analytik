/**
 * Reads a JSON export: one document (a list, or an object of lists), or newline-delimited JSON, which is what
 * BigQuery and many batch exports write. Returns what `ReadFile.parts` holds.
 */
export function parseJsonParts(text: string, name: string): Record<string, Record<string, unknown>[]> {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')
    try {
      data = lines.map((line) => JSON.parse(line) as unknown)
    } catch {
      throw new Error(`${name} is not valid JSON`)
    }
  }
  if (Array.isArray(data)) return { rows: data as Record<string, unknown>[] }
  if (data && typeof data === 'object') return data as Record<string, Record<string, unknown>[]>
  throw new Error(`${name} is not a list of rows`)
}
