import { describe, expect, it } from 'vitest'

import { isNewer } from '../src/shared/semver'

describe('isNewer', () => {
  it('compares plain versions by number, not by text', () => {
    expect(isNewer('1.2.0', '1.1.0')).toBe(true)
    expect(isNewer('1.10.0', '1.9.9')).toBe(true)
    expect(isNewer('2.0.0', '1.99.99')).toBe(true)
    expect(isNewer('1.1.1', '1.1.0')).toBe(true)
    expect(isNewer('1.1.0', '1.1.0')).toBe(false)
    expect(isNewer('1.0.9', '1.1.0')).toBe(false)
  })

  it('never offers a pre-release, and ignores what it cannot read', () => {
    expect(isNewer('1.2.0-rc.1', '1.1.0')).toBe(false)
    expect(isNewer('v1.2.0', '1.1.0')).toBe(true)
    expect(isNewer('1.2.0', '1.1.0-beta.2')).toBe(true)
    expect(isNewer('next', '1.1.0')).toBe(false)
    expect(isNewer('1.2.0', 'dev')).toBe(false)
  })
})
