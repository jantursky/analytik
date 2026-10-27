import { describe, expect, it } from 'vitest'

import { DIRECT_SOURCE, classify, domainForSource, findKnownSource } from '../src/shared/channels'
import { fromBase64, sha256Hex, timingSafeEqual, toBase64, toBase64Url } from '../src/shared/crypto'
import { isId, isSiteId, randomId } from '../src/shared/ids'
import {
  DAY,
  HOUR,
  autoInterval,
  bucketStarts,
  clampInterval,
  isValidTimeZone,
  monthKey,
  parseDate,
  startOfBucket,
  tzOffset,
  zonedTime,
} from '../src/shared/time'
import { isBot, parseUserAgent } from '../src/shared/ua'
import {
  cleanDomain,
  clip,
  extractCampaign,
  hostBelongsTo,
  isLocalhost,
  normalizePath,
  pagePath,
  parseReferrer,
} from '../src/shared/url'
import { normalizeParams, placeholders, splitStatements, toNumberedPlaceholders } from '../src/storage/sql/statements'

describe('channels', () => {
  it('prefers explicit tags over the referrer', () => {
    expect(classify({ referrerDomain: 'google.com', utmSource: 'twitter' })).toEqual({
      source: 'X',
      channel: 'Organic Social',
    })
    expect(classify({ referrerDomain: null, ref: 'launch-post' })).toEqual({
      source: 'launch-post',
      channel: 'Referral',
    })
    expect(classify({ referrerDomain: 'news.ycombinator.com' })).toEqual({
      source: 'Hacker News',
      channel: 'Organic Social',
    })
    expect(classify({ referrerDomain: 'chatgpt.com' })).toEqual({ source: 'ChatGPT', channel: 'AI' })
    expect(classify({ referrerDomain: 'some-blog.net' })).toEqual({ source: 'some-blog.net', channel: 'Referral' })
    expect(classify({ referrerDomain: null })).toEqual({ source: DIRECT_SOURCE, channel: 'Direct' })
  })

  it('lets the medium decide paid, email and social traffic', () => {
    expect(classify({ referrerDomain: 'google.com', utmMedium: 'cpc' }).channel).toBe('Paid')
    expect(classify({ referrerDomain: null, utmSource: 'spring', utmMedium: 'newsletter' }).channel).toBe('Email')
    expect(classify({ referrerDomain: null, utmSource: 'forum', utmMedium: 'social' }).channel).toBe('Organic Social')
    expect(classify({ referrerDomain: 'bing.com', utmMedium: 'social' }).channel).toBe('Organic Search')
  })

  it('finds known sources and their favicon domains', () => {
    expect(findKnownSource(' YouTube ')?.name).toBe('YouTube')
    expect(findKnownSource(undefined)).toBeUndefined()
    expect(domainForSource('GitHub')).toBe('github.com')
    expect(domainForSource('Newsletter')).toBeUndefined()
    expect(domainForSource('Unknown')).toBeUndefined()
    expect(domainForSource('Google')).toBe('google.com')
  })

  it('matches subdomains and public suffixes, the most specific host first', () => {
    expect(findKnownSource('www.google.co.uk')?.name).toBe('Google')
    expect(findKnownSource('images.google.de')?.name).toBe('Google')
    expect(findKnownSource('mail.google.com')?.name).toBe('Gmail')
    expect(findKnownSource('gemini.google.com')?.name).toBe('Gemini')
    expect(findKnownSource('m.youtube.com')?.name).toBe('YouTube')
    expect(findKnownSource('google.example.com')).toBeUndefined()
    expect(findKnownSource('notreddit.com')).toBeUndefined()
    expect(classify({ referrerDomain: 'com.google.android.gm' })).toEqual({ source: 'Gmail', channel: 'Email' })
    expect(classify({ referrerDomain: null, utmSource: 'Mastodon.Social', utmMedium: 'CPC' })).toEqual({
      source: 'Mastodon',
      channel: 'Paid',
    })
  })
})

describe('ids and crypto', () => {
  it('makes ids of the requested length from the injected random source', () => {
    expect(randomId(10)).toMatch(/^[0-9a-z]{10}$/)
    let calls = 0
    const random = (size: number) => new Uint8Array(size).fill(calls++ === 0 ? 255 : 1)
    expect(randomId(4, random)).toBe('1111')
    expect(isId('abc-DEF_12')).toBe(true)
    expect(isId('short')).toBe(false)
    expect(isId('bad id with spaces')).toBe(false)
    expect(isId(12345678)).toBe(false)
    expect(isSiteId('demo')).toBe(true)
    expect(isSiteId('')).toBe(false)
  })

  it('encodes, hashes and compares', async () => {
    const bytes = new Uint8Array([251, 255, 0])
    expect(toBase64(bytes)).toBe('+/8A')
    expect(toBase64Url(bytes)).toBe('-_8A')
    expect([...fromBase64('+/8A')]).toEqual([251, 255, 0])
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(timingSafeEqual('secret', 'secret')).toBe(true)
    expect(timingSafeEqual('secreT', 'secret')).toBe(false)
    expect(timingSafeEqual('secret-longer', 'secret')).toBe(false)
    expect(timingSafeEqual('sec', 'secret')).toBe(false)
  })
})

describe('time', () => {
  it('computes offsets across daylight saving changes', () => {
    expect(tzOffset('UTC', Date.UTC(2026, 0, 1))).toBe(0)
    expect(tzOffset('Europe/Berlin', Date.UTC(2026, 0, 1))).toBe(HOUR)
    expect(tzOffset('Europe/Berlin', Date.UTC(2026, 6, 1))).toBe(2 * HOUR)
    expect(tzOffset('Asia/Kolkata', Date.UTC(2026, 0, 1))).toBe(5.5 * HOUR)
    expect(zonedTime('Europe/Berlin', 2026, 3, 29)).toBe(Date.UTC(2026, 2, 28, 23))
    expect(zonedTime('Europe/Berlin', 2026, 3, 30)).toBe(Date.UTC(2026, 2, 29, 22))
  })

  it('finds bucket starts in the local calendar', () => {
    const at = Date.UTC(2026, 2, 18, 15, 42, 10, 5)
    expect(startOfBucket(at, 'hour', 'UTC')).toBe(Date.UTC(2026, 2, 18, 15))
    expect(startOfBucket(at, 'hour', 'Asia/Kolkata')).toBe(Date.UTC(2026, 2, 18, 15, 30))
    expect(startOfBucket(at, 'day', 'America/New_York')).toBe(Date.UTC(2026, 2, 18, 4))
    expect(startOfBucket(at, 'week', 'UTC')).toBe(Date.UTC(2026, 2, 16))
    expect(startOfBucket(Date.UTC(2026, 2, 22, 12), 'week', 'UTC')).toBe(Date.UTC(2026, 2, 16))
    expect(startOfBucket(at, 'month', 'Europe/Berlin')).toBe(Date.UTC(2026, 1, 28, 23))
  })

  it('lists buckets without gaps, with 23- and 25-hour days', () => {
    const days = bucketStarts(Date.UTC(2026, 2, 28, 23), Date.UTC(2026, 2, 31, 22), 'day', 'Europe/Berlin')
    expect(days).toEqual([Date.UTC(2026, 2, 28, 23), Date.UTC(2026, 2, 29, 22), Date.UTC(2026, 2, 30, 22)])
    expect(bucketStarts(Date.UTC(2026, 0, 15), Date.UTC(2026, 3, 1), 'month', 'UTC')).toEqual([
      Date.UTC(2026, 0, 1),
      Date.UTC(2026, 1, 1),
      Date.UTC(2026, 2, 1),
    ])
    expect(bucketStarts(Date.UTC(2026, 2, 16), Date.UTC(2026, 2, 30), 'week', 'UTC')).toHaveLength(2)
    expect(bucketStarts(0, 3 * HOUR, 'hour', 'UTC')).toEqual([0, HOUR, 2 * HOUR])
  })

  it('picks and clamps intervals', () => {
    expect(autoInterval(0, DAY)).toBe('hour')
    expect(autoInterval(0, 30 * DAY)).toBe('day')
    expect(autoInterval(0, 200 * DAY)).toBe('week')
    expect(autoInterval(0, 800 * DAY)).toBe('month')
    expect(clampInterval(0, 7 * DAY, 'hour')).toBe('hour')
    expect(clampInterval(0, 365 * DAY, 'hour')).toBe('week')
    expect(clampInterval(0, 10 * DAY, undefined)).toBe('day')
  })

  it('parses dates in a timezone and validates timezones', () => {
    expect(parseDate('2026-03-16', 'UTC')).toBe(Date.UTC(2026, 2, 16))
    expect(parseDate('2026-03-16', 'Europe/Berlin', true)).toBe(Date.UTC(2026, 2, 16, 23))
    expect(parseDate('2026-03-16T10:00:00+02:00', 'UTC')).toBe(Date.UTC(2026, 2, 16, 8))
    expect(parseDate('2026-03-16T99:00', 'UTC')).toBeNull()
    expect(parseDate('March 16', 'UTC')).toBeNull()
    expect(isValidTimeZone('Europe/Bratislava')).toBe(true)
    expect(isValidTimeZone('Mars/Base')).toBe(false)
    expect(monthKey(Date.UTC(2026, 11, 31, 23, 59))).toBe('2026-12')
  })
})

describe('user agents', () => {
  it('detects bots, previews and HTTP clients', () => {
    for (const agent of [
      '',
      null,
      'Googlebot/2.1',
      'curl/8.0',
      'Mozilla/5.0 (compatible; GPTBot/1.0)',
      'HeadlessChrome/120',
    ]) {
      expect(isBot(agent)).toBe(true)
    }
    expect(isBot('Mozilla/5.0 (Windows NT 10.0) Chrome/141.0 Safari/537.36')).toBe(false)
  })

  it('reads browser, OS and device', () => {
    expect(
      parseUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36 Edg/141.0',
      ),
    ).toEqual({
      browser: 'Edge',
      os: 'Windows',
      device: 'Desktop',
    })
    expect(
      parseUserAgent(
        'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
      ),
    ).toEqual({
      browser: 'Mobile Safari',
      os: 'iPadOS',
      device: 'Tablet',
    })
    expect(
      parseUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36'),
    ).toEqual({
      browser: 'Chrome',
      os: 'Android',
      device: 'Mobile',
    })
    expect(parseUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0', 390).device).toBe(
      'Mobile',
    )
    expect(parseUserAgent('Something else')).toEqual({ browser: 'Other', os: 'Other', device: 'Desktop' })
  })
})

describe('urls', () => {
  it('normalizes paths', () => {
    expect(normalizePath('/caf%C3%A9//menu/')).toBe('/café/menu')
    expect(normalizePath('/%E0%A4%A')).toBe('/%E0%A4%A')
    expect(normalizePath('')).toBe('/')
    expect(normalizePath(`/${'a'.repeat(600)}`)).toHaveLength(500)
  })

  it('keeps only allowed query keys in page paths', () => {
    const url = new URL('https://example.com/search/?q=shoes&token=x&utm_source=ad#top')
    expect(pagePath(url)).toBe('/search')
    expect(pagePath(url, ['q', 'token'])).toBe('/search?q=shoes')
  })

  it('extracts campaign tags', () => {
    expect(
      extractCampaign(
        new URL('https://e.com/?utm_source=a&utm_medium=b&utm_campaign=c&utm_term=d&utm_content=e&via=f'),
      ),
    ).toEqual({
      utmSource: 'a',
      utmMedium: 'b',
      utmCampaign: 'c',
      utmTerm: 'd',
      utmContent: 'e',
      ref: 'f',
    })
    expect(extractCampaign(new URL('https://e.com/?source=g')).ref).toBe('g')
    expect(clip('  x  ')).toBe('x')
    expect(clip('   ')).toBeNull()
    expect(clip(5)).toBeNull()
  })

  it('checks domains, subdomains and localhost', () => {
    expect(hostBelongsTo('www.shop.example.com', 'example.com')).toBe(true)
    expect(hostBelongsTo('notexample.com', 'example.com')).toBe(false)
    expect(isLocalhost('localhost')).toBe(true)
    expect(isLocalhost('127.0.0.1')).toBe(true)
    expect(isLocalhost('app.localhost')).toBe(true)
    expect(isLocalhost('example.com')).toBe(false)
    expect(cleanDomain('HTTPS://www.Example.co.uk:8080/path?x')).toBe('example.co.uk')
    expect(cleanDomain('localhost')).toBeNull()
  })

  it('parses referrers', () => {
    expect(parseReferrer('https://www.reddit.com/r/x/', 'example.com')).toEqual({
      referrer: 'reddit.com/r/x',
      referrerDomain: 'reddit.com',
    })
    expect(parseReferrer('https://example.com/a', 'example.com')).toEqual({ referrer: null, referrerDomain: null })
    expect(parseReferrer('about:blank', 'example.com')).toEqual({ referrer: null, referrerDomain: null })
    expect(parseReferrer('nonsense', 'example.com')).toEqual({ referrer: null, referrerDomain: null })
    expect(parseReferrer(undefined, 'example.com')).toEqual({ referrer: null, referrerDomain: null })
  })
})

describe('sql helpers', () => {
  it('numbers placeholders outside quotes', () => {
    expect(toNumberedPlaceholders(`SELECT ? , '?' , "a?" , ?`)).toBe(`SELECT $1 , '?' , "a?" , $2`)
  })

  it('splits migrations and builds placeholders', () => {
    expect(splitStatements('-- comment\nCREATE TABLE a (x TEXT);\n\nCREATE INDEX b ON a (x);')).toEqual([
      'CREATE TABLE a (x TEXT)',
      'CREATE INDEX b ON a (x)',
    ])
    expect(placeholders(3)).toBe('?, ?, ?')
    expect(normalizeParams([true, false, undefined, 1, 'x', null])).toEqual([1, 0, null, 1, 'x', null])
    expect(normalizeParams()).toEqual([])
  })
})
