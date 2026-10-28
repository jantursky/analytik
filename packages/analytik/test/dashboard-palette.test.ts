import { describe, expect, it } from 'vitest'

import { fuzzyScore } from '../src/dashboard/palette'

describe('fuzzyScore', () => {
  it('matches every word, best when it starts the text', () => {
    expect(fuzzyScore('rev', 'Go to Revenue')).not.toBeNull()
    expect(fuzzyScore('go rev', 'Go to Revenue')).not.toBeNull()
    expect(fuzzyScore('rev', 'Revenue')).toBeLessThan(fuzzyScore('rev', 'Go to Revenue') ?? 0)
    expect(fuzzyScore('SLOVAKIA', 'Filter: country is Slovakia')).not.toBeNull()
  })

  it('lets a word skip a few letters, but not wander across the text', () => {
    expect(fuzzyScore('rvn', 'Go to Revenue')).not.toBeNull()
    expect(fuzzyScore('seg', 'Switch to Example')).toBeNull()
    expect(fuzzyScore('xyz', 'Go to Revenue')).toBeNull()
    expect(fuzzyScore('rev zzz', 'Go to Revenue')).toBeNull()
  })
})
