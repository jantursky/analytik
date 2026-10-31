import { languageTag } from '../i18n'
import { Combobox } from './combobox'

export interface Currency {
  code: string
  name: string
  symbol: string
}

// What older engines, which cannot list every currency, offer.
const COMMON = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'CZK', 'PLN', 'SEK']

// Built for the chosen language the first time it is needed, and again if the language changes.
let all: { tag: string; list: Map<string, Currency> } | undefined

/** Every ISO 4217 currency the browser knows, with its name in the chosen language and its narrow symbol. */
export function currencies(): Map<string, Currency> {
  const tag = languageTag()
  if (all?.tag === tag) return all.list
  let codes: string[] = []
  try {
    codes = Intl.supportedValuesOf('currency')
  } catch {
    // Older engines: offer the common ones only.
  }
  const names = new Intl.DisplayNames([tag], { type: 'currency' })
  const symbol = (code: string): string =>
    new Intl.NumberFormat(tag, { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' })
      .formatToParts(0)
      .find((part) => part.type === 'currency')?.value ?? code
  const ordered = [...new Set(codes.length ? codes : COMMON)].sort()
  const list = new Map(ordered.map((code) => [code, { code, name: names.of(code) ?? code, symbol: symbol(code) }]))
  all = { tag, list }
  return list
}

/** A searchable currency list: code, name and symbol, matched on code or name. */
export function CurrencySelect({
  label,
  value,
  onChange,
  hint,
}: {
  label: string
  value: string
  onChange: (code: string) => void
  hint?: string
}) {
  const list = currencies()
  const options = list.has(value) ? [...list.keys()] : [value, ...list.keys()]
  return (
    <Combobox
      label={label}
      value={value}
      options={options}
      onChange={onChange}
      hint={hint}
      describe={(code) => {
        const currency = list.get(code)
        return {
          label: currency ? `${code} · ${currency.name}` : code,
          leading: (
            <span className="analytik-currency-symbol" aria-hidden="true">
              {currency?.symbol ?? code}
            </span>
          ),
        }
      }}
    />
  )
}
