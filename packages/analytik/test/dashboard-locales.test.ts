import { readdirSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { LANGUAGES } from '../src/dashboard/i18n'
import { extractMessages } from '../scripts/extract-messages.mjs'

// Every file in locales/ is a catalog, named by its language code.
const files = readdirSync('src/dashboard/locales').filter((file) => file.endsWith('.ts'))
const catalogs: Record<string, Record<string, string>> = {}
for (const file of files) {
  const module = (await import(`../src/dashboard/locales/${file}`)) as { default: Record<string, string> }
  catalogs[file.slice(0, -3)] = module.default
}
// Plural forms hold text, not placeholders, so they are cut out before the names are read.
const placeholders = (text: string): string[] => {
  const outer = text.replace(/(?<!\w)(?:=\d+|zero|one|two|few|many|other) \{[^{}]*\}/g, (form) =>
    form.replace(/\{(\w+)\}/g, '{#}'),
  )
  return [...new Set([...outer.matchAll(/\{(\w+)[,}]/g)].flatMap((m) => m[1] ?? []))].sort()
}
const keys = [...extractMessages().keys()]

describe.each(Object.entries(catalogs))('%s catalog', (_, catalog) => {
  it('translates every string the dashboard asks for', () => {
    expect(keys.filter((key) => !(key in catalog))).toEqual([])
  })

  it('holds nothing the dashboard no longer asks for', () => {
    expect(Object.keys(catalog).filter((key) => !keys.includes(key))).toEqual([])
  })

  it('keeps every placeholder of the English text', () => {
    const broken = Object.entries(catalog).filter(
      ([key, text]) => placeholders(key).join() !== placeholders(text).join(),
    )
    expect(broken.map(([key]) => key)).toEqual([])
  })

  it('leaves no text empty', () => {
    expect(Object.entries(catalog).filter(([, text]) => !text.trim())).toEqual([])
  })
})

describe('catalogs', () => {
  it('are the shipped languages: a file for each, and each file shipped', () => {
    const shipped = LANGUAGES.map((l) => l.value).filter((value) => value !== 'en')
    expect(Object.keys(catalogs).sort()).toEqual(shipped.sort())
  })

  it('exist for every shipped language but English', () => {
    expect(LANGUAGES.map((l) => l.value).filter((value) => value !== 'en' && !(value in catalogs))).toEqual([])
  })
})
