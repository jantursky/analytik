import { describe, expect, it } from 'vitest'

import { prepareImport } from '../src/shared/import/prepare'
import { sampleExport } from '../src/shared/import/samples'
import { parseCsv } from '../src/shared/import/csv'
import type { ImportSource } from '../src/shared/import/types'

const NOW = Date.UTC(2026, 2, 16, 12)
const options = { visits: 40, days: 30, now: NOW }

describe.each<ImportSource>(['umami', 'simple-analytics'])('sample %s export', (source) => {
  it('is deterministic', () => {
    expect(sampleExport(source, options)).toEqual(sampleExport(source, options))
  })

  it('imports without skipped rows', () => {
    const files = sampleExport(source, options)
    const prepared = prepareImport(
      source,
      files.map((file) => ({ name: file.name, parts: { rows: parseCsv(file.content) } })),
    )
    expect(prepared.skipped).toEqual([])
    expect(prepared.visits.length).toBeGreaterThan(0)
  })
})
