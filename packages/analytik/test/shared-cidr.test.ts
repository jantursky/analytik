import { describe, expect, it } from 'vitest'

import { ipMatcher, parseIp, parseRange } from '../src/shared/cidr'

describe('parseRange', () => {
  it('reads a single address as the narrowest range', () => {
    expect(parseRange('203.0.113.7')).toMatchObject({ family: 4, prefix: 32 })
    expect(parseRange('2001:db8::1')).toMatchObject({ family: 6, prefix: 128 })
  })

  it('reads ranges and rounds down to the network address', () => {
    const range = parseRange('203.0.113.77/24')
    expect(range?.end).toBe((parseIp('203.0.113.255') ?? { value: 0n }).value)
    expect(range?.start).toBe((parseIp('203.0.113.0') ?? { value: 0n }).value)
  })

  it('rejects malformed entries', () => {
    for (const bad of [
      '',
      'abc',
      '1.2.3',
      '1.2.3.4.5',
      '256.1.1.1',
      '1.2.3.4/',
      '1.2.3.4/x',
      '1.2.3.4/33',
      '1.2.3.4/8/8',
      '1::2::3',
    ])
      expect(parseRange(bad), bad).toBeNull()
  })

  it('rejects ranges wider than /8 for IPv4 and /32 for IPv6', () => {
    expect(parseRange('0.0.0.0/0')).toBeNull()
    expect(parseRange('10.0.0.0/7')).toBeNull()
    expect(parseRange('10.0.0.0/8')).not.toBeNull()
    expect(parseRange('::/0')).toBeNull()
    expect(parseRange('2001:db8::/31')).toBeNull()
    expect(parseRange('2001:db8::/32')).not.toBeNull()
  })
})

describe('ipMatcher', () => {
  it('matches exact addresses and ranges, per family', () => {
    const match = ipMatcher(['198.51.100.9', '203.0.113.0/24', '2001:db8:abcd::/48'])
    expect(match('198.51.100.9')).toBe(true)
    expect(match('198.51.100.10')).toBe(false)
    expect(match('203.0.113.200')).toBe(true)
    expect(match('203.0.114.1')).toBe(false)
    expect(match('2001:db8:abcd:1::5')).toBe(true)
    expect(match('2001:db8:abce::1')).toBe(false)
  })

  it('reads an IPv4 address on a dual-stack socket as IPv4', () => {
    expect(ipMatcher(['203.0.113.0/24'])('::ffff:203.0.113.5')).toBe(true)
  })

  it('skips entries that do not parse but still matches them as text', () => {
    const match = ipMatcher(['garbage', '203.0.113.7'])
    expect(match('203.0.113.7')).toBe(true)
    expect(match('garbage')).toBe(true)
    expect(match('203.0.113.8')).toBe(false)
    expect(match('not an ip')).toBe(false)
  })
})
