import { afterEach, describe, expect, it } from 'vitest'

import {
  countryName,
  formatAgo,
  formatBucket,
  formatChange,
  formatDuration,
  formatNumber,
} from '../src/dashboard/format'
import { loadMessages, msg, resolveLanguage, setLanguage, t } from '../src/dashboard/i18n'

afterEach(() => setLanguage('en', {}))

describe('translations', () => {
  it('shows English text when nothing translates it', () => {
    expect(t('Overview')).toBe('Overview')
    setLanguage('sk', { Pages: 'Stránky' })
    expect(t('Overview')).toBe('Overview')
    expect(t('Pages')).toBe('Stránky')
  })

  it('fills parameters and leaves unknown ones in place', () => {
    expect(t('Hello {name}, {other}', { name: 'Jan' })).toBe('Hello Jan, {other}')
  })

  it('chooses the plural form of the language', () => {
    const text = '{count, plural, one {# visitor} other {# visitors}}'
    expect(t(text, { count: 1 })).toBe('1 visitor')
    expect(t(text, { count: 3 })).toBe('3 visitors')
    setLanguage('sk', { [text]: '{count, plural, one {# návštevník} few {# návštevníci} other {# návštevníkov}}' })
    expect(t(text, { count: 1 })).toBe('1 návštevník')
    expect(t(text, { count: 3 })).toBe('3 návštevníci')
    expect(t(text, { count: 7 })).toBe('7 návštevníkov')
  })

  it('lets custom messages win over the catalog, for any language', () => {
    setLanguage('sk', { Overview: 'Prehľad' }, { Overview: 'Domov' })
    expect(t('Overview')).toBe('Domov')
    setLanguage('en', {}, { Overview: 'Home' })
    expect(t('Overview')).toBe('Home')
  })

  it('marks text without changing it', () => {
    expect(msg('Overview')).toBe('Overview')
  })

  it('picks the language from the prop, the saved choice or the browser', () => {
    expect(resolveLanguage('sk', 'en', ['de'])).toBe('sk')
    expect(resolveLanguage('sk-SK', undefined)).toBe('sk')
    expect(resolveLanguage(undefined, 'sk', ['en-US'])).toBe('sk')
    expect(resolveLanguage(undefined, undefined, ['ar-EG', 'sk-SK'])).toBe('sk')
    expect(resolveLanguage('xx', 'nope', ['ar'])).toBe('en')
    expect(resolveLanguage(undefined, undefined, ['pl-PL', 'de'])).toBe('pl')
  })

  it('loads a catalog on demand and gives English an empty one', async () => {
    expect(await loadMessages('en')).toEqual({})
    expect(typeof (await loadMessages('sk'))).toBe('object')
  })
})

describe('locale formatting', () => {
  it('writes numbers, month names and country names in the chosen language', () => {
    expect(formatNumber(1234.5)).toBe('1,235')
    expect(countryName('DE')).toBe('Germany')
    setLanguage('sk', {})
    expect(formatNumber(1234)).toBe('1 234')
    expect(countryName('DE')).toBe('Nemecko')
    expect(formatBucket(Date.UTC(2026, 9, 27, 12), 'month', 'UTC')).toBe('okt 2026')
  })

  it('translates the words inside formatted values', () => {
    setLanguage('sk', { '{n}m ago': 'pred {n} min', new: 'nové', '{seconds}s': '{seconds} s' })
    expect(formatAgo(0, 120_000)).toBe('pred 2 min')
    expect(formatChange(null)).toBe('nové')
    expect(formatDuration(5000)).toBe('5 s')
  })
})
