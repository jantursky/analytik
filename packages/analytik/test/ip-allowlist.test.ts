import { describe, expect, it } from 'vitest'

import { allowedByList, normalizeAllowlist, normalizeEntry, parseAddress } from '../src/shared/ip-allowlist'

describe('normalizeEntry', () => {
  it('keeps a single address without a prefix', () => {
    expect(normalizeEntry('203.0.113.7')).toBe('203.0.113.7')
    expect(normalizeEntry('203.0.113.7/32')).toBe('203.0.113.7')
    expect(normalizeEntry('2001:DB8:0:0:0:0:0:1')).toBe('2001:db8::1')
    expect(normalizeEntry('2001:db8::1/128')).toBe('2001:db8::1')
  })

  it('masks a range to its network bits', () => {
    expect(normalizeEntry('203.0.113.77/24')).toBe('203.0.113.0/24')
    expect(normalizeEntry('2001:db8:abcd::5/32')).toBe('2001:db8::/32')
    expect(normalizeEntry('10.1.2.3/0')).toBe('0.0.0.0/0')
    expect(normalizeEntry('::/0')).toBe('::/0')
  })

  it('treats IPv4-mapped IPv6 as IPv4', () => {
    expect(normalizeEntry('::ffff:192.0.2.1')).toBe('192.0.2.1')
    expect(normalizeEntry('::ffff:c000:201')).toBe('192.0.2.1')
    expect(normalizeEntry('::ffff:192.0.2.0/120')).toBe('192.0.2.0/24')
    expect(() => normalizeEntry('::ffff:192.0.2.0/64')).toThrow('IPv4 range')
  })

  it('compresses the longest zero run and leaves a single zero group alone', () => {
    expect(normalizeEntry('2001:0:0:1:0:0:0:1')).toBe('2001:0:0:1::1')
    expect(normalizeEntry('2001:db8:0:1:1:1:1:1')).toBe('2001:db8:0:1:1:1:1:1')
    expect(normalizeEntry('0:0:0:0:0:0:0:1')).toBe('::1')
  })

  it.each([
    ['10.0.0.1/33', 'from 0 to 32'],
    ['2001:db8::/129', 'from 0 to 128'],
    ['10.0.0.256', 'not an IPv4 or IPv6'],
    ['10.0.0.01', 'not an IPv4 or IPv6'],
    ['10.0.0', 'not an IPv4 or IPv6'],
    ['example.com', 'not an IPv4 or IPv6'],
    ['fe80::1%eth0', 'not an IPv4 or IPv6'],
    ['1:2:3:4:5:6:7:8:9', 'not an IPv4 or IPv6'],
    ['1::2::3', 'not an IPv4 or IPv6'],
    ['10.0.0.1/', 'whole number'],
    ['10.0.0.1/a', 'whole number'],
    ['10.0.0.1/8/8', 'one slash'],
    ['', 'enter an IPv4'],
  ])('rejects %s, naming it', (entry, reason) => {
    expect(() => normalizeEntry(entry)).toThrow(reason)
    if (entry) expect(() => normalizeEntry(entry)).toThrow(`"${entry}"`)
  })

  it('accepts the boundaries of both families', () => {
    expect(normalizeEntry('0.0.0.0/0')).toBe('0.0.0.0/0')
    expect(normalizeEntry('255.255.255.255/32')).toBe('255.255.255.255')
    expect(normalizeEntry('ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff/128')).toBe(
      'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
    )
  })
})

describe('normalizeAllowlist', () => {
  it('treats nothing as an empty list and drops duplicates', () => {
    expect(normalizeAllowlist(undefined)).toEqual([])
    expect(normalizeAllowlist(null)).toEqual([])
    expect(normalizeAllowlist(['10.0.0.1', '10.0.0.1/32', '::ffff:10.0.0.1'])).toEqual(['10.0.0.1'])
  })

  it('allows 20 entries and refuses 21', () => {
    const entries = Array.from({ length: 21 }, (_, i) => `10.0.0.${i}`)
    expect(normalizeAllowlist(entries.slice(0, 20))).toHaveLength(20)
    expect(() => normalizeAllowlist(entries)).toThrow('at most 20')
  })

  it('refuses anything that is not a list of text', () => {
    expect(() => normalizeAllowlist('10.0.0.1')).toThrow('must be a list')
    expect(() => normalizeAllowlist([10])).toThrow('must be text')
  })
})

describe('allowedByList', () => {
  it('matches inside a range and refuses outside it', () => {
    const list = ['203.0.113.0/24', '2001:db8::/32']
    expect(allowedByList(list, '203.0.113.7')).toBe(true)
    expect(allowedByList(list, '203.0.113.255')).toBe(true)
    expect(allowedByList(list, '203.0.114.1')).toBe(false)
    expect(allowedByList(list, '198.51.100.1')).toBe(false)
    expect(allowedByList(list, '2001:db8::5')).toBe(true)
    expect(allowedByList(list, '2001:db9::5')).toBe(false)
  })

  it('matches the exact address of a single entry and the whole space of /0', () => {
    expect(allowedByList(['192.0.2.1'], '192.0.2.1')).toBe(true)
    expect(allowedByList(['192.0.2.1'], '192.0.2.2')).toBe(false)
    expect(allowedByList(['0.0.0.0/0'], '198.51.100.1')).toBe(true)
    expect(allowedByList(['::/0'], '2001:db8::1')).toBe(true)
  })

  it('does not mix the families, except through IPv4-mapped addresses', () => {
    expect(allowedByList(['0.0.0.0/0'], '2001:db8::1')).toBe(false)
    expect(allowedByList(['::/0'], '192.0.2.1')).toBe(false)
    expect(allowedByList(['192.0.2.0/24'], '::ffff:192.0.2.9')).toBe(true)
  })

  it('refuses an unknown or unreadable address', () => {
    expect(allowedByList(['0.0.0.0/0'], null)).toBe(false)
    expect(allowedByList(['0.0.0.0/0'], undefined)).toBe(false)
    expect(allowedByList(['0.0.0.0/0'], 'garbage')).toBe(false)
    expect(allowedByList([], '192.0.2.1')).toBe(false)
  })

  it('reads addresses as bytes', () => {
    expect(parseAddress('192.0.2.1')).toEqual([192, 0, 2, 1])
    expect(parseAddress('::1')).toHaveLength(16)
    expect(parseAddress('nope')).toBeNull()
  })
})
