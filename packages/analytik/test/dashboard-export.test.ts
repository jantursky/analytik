import { describe, expect, it } from 'vitest'

import { csvCell, fileName, tableRows, toCsv } from '../src/dashboard/export'

describe('csvCell', () => {
  it('leaves plain text as it is', () => {
    expect(csvCell('/pricing')).toBe('/pricing')
  })

  it('quotes cells with commas, quotes and line breaks', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('one\ntwo')).toBe('"one\ntwo"')
  })

  it.each(['=cmd|calc', '+1', '-1+1', '@SUM(A1)', '\tx', '\rx'])('defuses the formula start of %j', (value) => {
    expect(csvCell(value).replace(/^"/, '')).toMatch(/^'/)
  })

  it('writes numbers and empty values plainly', () => {
    expect(csvCell(-3)).toBe('-3')
    expect(csvCell(0)).toBe('0')
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
  })
})

describe('toCsv', () => {
  it('joins cells with commas and rows with CRLF', () => {
    expect(
      toCsv([
        ['Page', 'Visitors'],
        ['=evil()', 12],
      ]),
    ).toBe("Page,Visitors\r\n'=evil(),12")
  })
})

describe('fileName', () => {
  it('keeps letters, digits and dashes', () => {
    expect(fileName(['example.com', 'Top pages'], 'csv')).toBe('example-com-top-pages.csv')
  })
})

describe('tableRows', () => {
  it('reads headings and cells and leaves out the open column', () => {
    document.body.innerHTML = `<table><thead><tr><th>Page</th><th class="analytik-open-cell">Open</th></tr></thead>
      <tbody><tr><td> /a  <b>x</b> </td><td class="analytik-open-cell"><button>go</button></td></tr></tbody></table>`
    const table = document.querySelector('table')
    if (!table) throw new Error('no table')
    expect(tableRows(table)).toEqual([['Page'], ['/a x']])
  })
})
