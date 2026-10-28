/** One CSV record as an object keyed by the header row. */
export type CsvRecord = Record<string, string>

export interface CsvReader {
  /** Feeds the next piece of text and returns the records completed by it. */
  push(chunk: string): CsvRecord[]
  /** Returns the last record when the text does not end with a newline. */
  end(): CsvRecord[]
}

/**
 * An incremental RFC 4180 reader: quoted cells, doubled quotes, newlines inside quotes, CRLF and a leading BOM.
 * It takes text in pieces, so a browser can stream a large file through it without holding all of it as text.
 * Header names are trimmed; blank lines are skipped.
 */
export function createCsvReader(delimiter = ','): CsvReader {
  let header: string[] | null = null
  let row: string[] = []
  let cell = ''
  let quoted = false
  // A quote seen inside a quoted cell: either the first of `""` or the closing quote; decided by the next character.
  let pendingQuote = false
  let started = false
  let skipLineFeed = false
  let touched = false

  const finishRow = (out: CsvRecord[]): void => {
    row.push(cell)
    cell = ''
    const blank = row.length === 1 && row[0] === '' && !touched
    const done = row
    row = []
    touched = false
    if (blank) return
    if (!header) {
      header = done.map((name) => name.trim())
      return
    }
    const record: CsvRecord = {}
    header.forEach((name, index) => {
      if (name) record[name] = done[index] ?? ''
    })
    out.push(record)
  }

  const feed = (chunk: string, out: CsvRecord[]): void => {
    let text = chunk
    if (!started) {
      started = true
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
    }
    for (const char of text) {
      if (skipLineFeed) {
        skipLineFeed = false
        if (char === '\n') continue
      }
      if (pendingQuote) {
        pendingQuote = false
        if (char === '"') {
          cell += '"'
          continue
        }
        quoted = false
      }
      if (quoted) {
        if (char === '"') pendingQuote = true
        else cell += char
        continue
      }
      if (char === '"' && cell === '') {
        quoted = true
        touched = true
      } else if (char === delimiter) {
        row.push(cell)
        cell = ''
        touched = true
      } else if (char === '\n' || char === '\r') {
        skipLineFeed = char === '\r'
        finishRow(out)
      } else {
        cell += char
        touched = true
      }
    }
  }

  return {
    push(chunk) {
      const out: CsvRecord[] = []
      feed(chunk, out)
      return out
    },
    end() {
      const out: CsvRecord[] = []
      pendingQuote = false
      if (touched || cell !== '' || row.length > 0) finishRow(out)
      return out
    },
  }
}

/** All records of a CSV text. */
export function parseCsv(text: string, delimiter = ','): CsvRecord[] {
  const reader = createCsvReader(delimiter)
  return [...reader.push(text), ...reader.end()]
}
