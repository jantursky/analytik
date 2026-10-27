import { describe, expect, it } from 'vitest'

import { attributeProps, clip, sanitizeProps } from '../src/tracker/payload'
import { cleanReferrer, cleanUrl, isLocalhost, isOutbound } from '../src/tracker/url'

describe('cleanUrl', () => {
  it('keeps campaign keys and payment return ids, drops other params and the fragment', () => {
    expect(
      cleanUrl('https://example.com/p?utm_source=x&utm_campaign=y&ref=hn&source=a&payment_id=pay_1&q=search#top'),
    ).toBe('https://example.com/p?utm_source=x&utm_campaign=y&ref=hn&source=a&payment_id=pay_1')
  })

  it('keeps listed params but never private ones', () => {
    expect(cleanUrl('https://example.com/?page=2&email=a%40b.c&token=t&Email=x', ['page', 'email'])).toBe(
      'https://example.com/?page=2',
    )
  })

  it('removes the question mark when nothing is left and returns unparseable input unchanged', () => {
    expect(cleanUrl('https://example.com/a?x=1')).toBe('https://example.com/a')
    expect(cleanUrl('not a url')).toBe('not a url')
  })
})

describe('cleanReferrer', () => {
  it('keeps origin and path only', () => {
    expect(cleanReferrer('https://news.example.org/item?id=1&email=a#c')).toBe('https://news.example.org/item')
    expect(cleanReferrer('')).toBeUndefined()
  })
})

describe('isLocalhost', () => {
  it.each([
    ['localhost', 'http:', true],
    ['127.0.0.1', 'http:', true],
    ['0.0.0.0', 'http:', true],
    ['[::1]', 'http:', true],
    ['mac.local', 'http:', true],
    ['', 'file:', true],
    ['example.com', 'https:', false],
    ['localhost.example.com', 'https:', false],
    ['127.example.com', 'https:', false],
  ])('%s %s -> %s', (host, protocol, expected) => {
    expect(isLocalhost(host, protocol)).toBe(expected)
  })
})

describe('isOutbound', () => {
  it('counts other http(s) hosts only', () => {
    expect(isOutbound(new URL('https://other.org/x'), 'example.com')).toBe(true)
    expect(isOutbound(new URL('https://example.com/x'), 'example.com')).toBe(false)
    expect(isOutbound(new URL('mailto:a@b.c'), 'example.com')).toBe(false)
  })

  it('treats the domain and its subdomains as internal', () => {
    expect(isOutbound(new URL('https://app.example.com/'), 'example.com', 'example.com')).toBe(false)
    expect(isOutbound(new URL('https://example.com/'), 'www.example.com', 'example.com')).toBe(false)
    expect(isOutbound(new URL('https://badexample.com/'), 'example.com', 'example.com')).toBe(true)
  })
})

describe('props', () => {
  it('clips keys and strings, keeps finite numbers, booleans and null, drops the rest', () => {
    const props = sanitizeProps({
      ['k'.repeat(70)]: 'v'.repeat(300),
      n: 1.5,
      inf: Infinity,
      b: false,
      z: null,
      o: { nested: true },
      u: undefined,
    })
    expect(props).toEqual({ ['k'.repeat(64)]: 'v'.repeat(255), n: 1.5, b: false, z: null })
  })

  it('keeps at most 30 props and returns undefined for nothing', () => {
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`p${i}`, i]))
    expect(Object.keys(sanitizeProps(many) ?? {})).toHaveLength(30)
    expect(sanitizeProps({})).toBeUndefined()
    expect(sanitizeProps(undefined)).toBeUndefined()
  })

  it('reads data-analytik-* attributes except the event name', () => {
    const el = document.createElement('button')
    el.setAttribute('data-analytik-event', 'signup')
    el.setAttribute('data-analytik-plan', 'pro')
    el.setAttribute('data-analytik-seats', '3')
    el.setAttribute('data-other', 'x')
    expect(attributeProps(el)).toEqual({ plan: 'pro', seats: '3' })
    expect(attributeProps(document.createElement('a'))).toBeUndefined()
    expect(clip(12345, 3)).toBe('123')
  })
})
