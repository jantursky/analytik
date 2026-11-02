/** Characters that make a spreadsheet read a cell as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/

/** One CSV cell: formula characters are defused with a leading apostrophe, and the cell is quoted when it needs to be. */
export function csvCell(value: string | number | null | undefined): string {
  if (value == null) return ''
  // A plain negative number is a number, not a formula.
  const text = typeof value === 'number' ? String(value) : FORMULA_START.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/** Rows of cells as CSV text, one line per row. */
export const toCsv = (rows: readonly (readonly (string | number | null | undefined)[])[]): string =>
  rows.map((row) => row.map(csvCell).join(',')).join('\r\n')

/** A file name made of the parts given: letters, digits and dashes only. */
export const fileName = (parts: readonly string[], extension: string): string =>
  `${parts
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')}.${extension}`

/** Hands the browser a file to save. */
export function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Saves rows as a CSV file; the byte order mark makes Excel read it as UTF-8. */
export const downloadCsv = (name: string, rows: Parameters<typeof toCsv>[0]): void =>
  download(name, new Blob(['﻿', toCsv(rows)], { type: 'text/csv;charset=utf-8' }))

/** The text of a cell, with a space between the pieces of text in nested elements. */
function cellText(cell: HTMLTableCellElement): string {
  const parts: string[] = []
  const walk = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
  for (let node = walk.nextNode(); node; node = walk.nextNode()) parts.push(node.textContent ?? '')
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

/** What a table shows right now as rows of text: the headings, then the rows, leaving out the row-open button column. */
export function tableRows(table: HTMLTableElement): string[][] {
  return [...table.rows].map((row) =>
    [...row.cells].filter((cell) => !cell.classList.contains('analytik-open-cell')).map(cellText),
  )
}
