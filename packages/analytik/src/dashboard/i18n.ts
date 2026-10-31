/** A catalog: English text to its translation. English is the source, so it needs no catalog. */
export type Messages = Record<string, string>

const SHIPPED = [
  { value: 'en', label: 'English' },
  { value: 'sk', label: 'Slovenčina' },
  { value: 'cs', label: 'Čeština' },
  { value: 'de', label: 'Deutsch' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'pt', label: 'Português' },
  { value: 'pl', label: 'Polski' },
  { value: 'it', label: 'Italiano' },
  { value: 'nl', label: 'Nederlands' },
  { value: 'ru', label: 'Русский' },
  { value: 'tr', label: 'Türkçe' },
  { value: 'ja', label: '日本語' },
  { value: 'zh', label: '简体中文' },
  { value: 'ko', label: '한국어' },
  { value: 'id', label: 'Bahasa Indonesia' },
  { value: 'hi', label: 'हिन्दी' },
  { value: 'vi', label: 'Tiếng Việt' },
] as const

const collator = new Intl.Collator('en')

/**
 * The languages the dashboard ships, as `locale` values, in alphabetical order of their own names. A language added to
 * the list above needs a catalog below.
 */
export const LANGUAGES = [...SHIPPED].sort((a, b) => collator.compare(a.label, b.label))

const TAGS: Record<string, string> = {
  en: 'en-US',
  sk: 'sk-SK',
  cs: 'cs-CZ',
  de: 'de-DE',
  es: 'es-ES',
  fr: 'fr-FR',
  pt: 'pt-BR',
  pl: 'pl-PL',
  it: 'it-IT',
  nl: 'nl-NL',
  ru: 'ru-RU',
  tr: 'tr-TR',
  ja: 'ja-JP',
  zh: 'zh-CN',
  ko: 'ko-KR',
  id: 'id-ID',
  hi: 'hi-IN',
  vi: 'vi-VN',
}

// Each catalog is its own chunk, fetched only for the chosen language.
const CATALOGS: Record<string, () => Promise<{ default: Messages }>> = {
  sk: () => import('./locales/sk'),
  cs: () => import('./locales/cs'),
  de: () => import('./locales/de'),
  es: () => import('./locales/es'),
  fr: () => import('./locales/fr'),
  pt: () => import('./locales/pt'),
  pl: () => import('./locales/pl'),
  it: () => import('./locales/it'),
  nl: () => import('./locales/nl'),
  ru: () => import('./locales/ru'),
  tr: () => import('./locales/tr'),
  ja: () => import('./locales/ja'),
  zh: () => import('./locales/zh'),
  ko: () => import('./locales/ko'),
  id: () => import('./locales/id'),
  hi: () => import('./locales/hi'),
  vi: () => import('./locales/vi'),
}

let language = 'en'
let catalog: Messages = {}
let overrides: Messages = {}

/**
 * Marks English text that is translated where it is shown, e.g. a label in a constant: `{ label: msg('Overview') }`
 * and later `t(item.label)`. It returns the text unchanged; the marker lets the catalog check find it.
 */
export const msg = <T extends string>(text: T): T => text

const PLURAL = /\{(\w+), plural,((?:[^{}]|\{[^{}]*\})*)\}/g
const FORM = /(=\d+|\w+)\s*\{([^{}]*)\}/g

function plural(count: number, forms: string): string {
  const options = new Map<string, string>()
  for (const [, key = '', text = ''] of forms.matchAll(FORM)) options.set(key, text)
  const form =
    options.get(`=${count}`) ??
    options.get(new Intl.PluralRules(languageTag()).select(count)) ??
    options.get('other') ??
    ''
  return form.replaceAll('#', count.toLocaleString(languageTag()))
}

/**
 * The text in the chosen language, with `{name}` filled from `params`. A count is written as an ICU plural:
 * `t('{count, plural, one {# visitor} other {# visitors}}', { count })`. Text with no translation shows in English.
 */
export function t(text: string, params?: Record<string, string | number>): string {
  const message = overrides[text] ?? catalog[text] ?? text
  if (!params) return message
  return message
    .replace(PLURAL, (_, name: string, forms: string) => plural(Number(params[name] ?? 0), forms))
    .replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole))
}

/**
 * Switches `t` and the formatters to a language. The dashboard calls it before it renders, like `setFormatSettings`,
 * so all of its parts speak the same language. `custom` replaces single strings without a code change.
 */
export function setLanguage(next: string, messages: Messages, custom: Messages = {}): void {
  language = next
  catalog = messages
  overrides = custom
}

export const currentLanguage = (): string => language

/** The BCP 47 tag `Intl` gets for the current language: `sk-SK`. */
export const languageTag = (): string => TAGS[language] ?? language

/** Orders two texts as the chosen language does, ignoring case and accents; numbers count by value. */
export const compareLabels = (a: string, b: string): number =>
  a.localeCompare(b, languageTag(), { sensitivity: 'base', numeric: true })

const isShipped = (value: unknown): value is string => LANGUAGES.some((l) => l.value === value)

/**
 * The language to use: the `locale` prop, else the saved choice, else the first browser language the dashboard ships
 * (`sk-SK` counts as `sk`), else English.
 */
export function resolveLanguage(chosen: string | undefined, saved: unknown, browser: readonly string[] = []): string {
  const base = chosen?.split('-')[0]
  if (isShipped(base)) return base
  if (isShipped(saved)) return saved
  return browser.map((tag) => tag.split('-')[0]).find(isShipped) ?? 'en'
}

/** The catalog of a language; empty for English and for a language whose chunk can't be fetched. */
export async function loadMessages(next: string): Promise<Messages> {
  try {
    return (await CATALOGS[next]?.())?.default ?? {}
  } catch {
    return {}
  }
}
