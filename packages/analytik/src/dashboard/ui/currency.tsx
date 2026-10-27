import { Combobox } from './combobox'

export interface Currency {
  code: string
  name: string
  symbol: string
}

// The most used currencies lead the list; the rest follow by code.
const FIRST = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'CZK', 'PLN', 'SEK']

let all: Map<string, Currency> | undefined

/** Every ISO 4217 currency the browser knows, with its English name and its narrow symbol. */
export function currencies(): Map<string, Currency> {
  if (all) return all
  let codes: string[] = []
  try {
    codes = Intl.supportedValuesOf('currency')
  } catch {
    // Older engines: offer the common ones only.
  }
  const names = new Intl.DisplayNames(['en'], { type: 'currency' })
  const symbol = (code: string): string =>
    new Intl.NumberFormat('en', { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' })
      .formatToParts(0)
      .find((part) => part.type === 'currency')?.value ?? code
  const ordered = [...new Set([...FIRST, ...codes.sort()])]
  all = new Map(ordered.map((code) => [code, { code, name: names.of(code) ?? code, symbol: symbol(code) }]))
  return all
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
