import { useState } from 'react'

import { useDashboard } from '../context'
import {
  formatDate,
  formatDateTime,
  formatInteger,
  formatMoney,
  formatNumber,
  formatPercent,
  type FormatSettings as Settings,
  formatSettings,
  formatTime,
  parseFormatSettings,
  setFormatSettings,
} from '../format'
import { parseTheme, usePreferences } from '../preferences'
import { Card } from '../ui'
import { Select } from '../ui/select'

// Shown in each option and under each select, written the way the option would write them.
const AMOUNT = 123456789
const NUMBER = 1234567

/** Runs `write` with `settings` in effect, then puts the current ones back. */
function sample(settings: Settings, write: () => string): string {
  const saved = formatSettings()
  setFormatSettings(settings)
  try {
    return write()
  } finally {
    setFormatSettings(saved)
  }
}

interface Choice<K extends keyof Settings> {
  value: Settings[K]
  label: string
}

const CHOICES: { [K in keyof Settings]: { label: string; options: Choice<K>[] } } = {
  numbers: {
    label: 'Numbers',
    options: [
      { value: 'comma', label: 'Comma groups, dot decimals' },
      { value: 'dot', label: 'Dot groups, comma decimals' },
      { value: 'space', label: 'Space groups, comma decimals' },
      { value: 'apostrophe', label: 'Apostrophe groups, dot decimals' },
    ],
  },
  currency: {
    label: 'Currency',
    options: [
      { value: 'symbol', label: 'Symbol' },
      { value: 'code', label: 'Code' },
    ],
  },
  cents: {
    label: 'Cents',
    options: [
      { value: 'always', label: 'Always' },
      { value: 'auto', label: 'Only when there are some' },
    ],
  },
  date: {
    label: 'Dates',
    options: [
      { value: 'us', label: 'Month first, in words' },
      { value: 'gb', label: 'Day first, in words' },
      { value: 'dmy', label: 'Day, month, year' },
      { value: 'mdy', label: 'Month, day, year' },
      { value: 'iso', label: 'ISO 8601' },
    ],
  },
  time: {
    label: 'Time',
    options: [
      { value: '12h', label: '12-hour clock' },
      { value: '24h', label: '24-hour clock' },
    ],
  },
}

/**
 * How numbers, money, dates and times are written across the dashboard. Each option shows an example written its
 * way; changes apply at once and are saved for every admin, like the overview layout.
 */
export function FormatSettings() {
  const { site } = useDashboard()
  const { values, update } = usePreferences()
  const settings = parseFormatSettings(values.format)
  const [now] = useState(Date.now)
  const examples: { [K in keyof Settings]: () => string } = {
    numbers: () => `${formatInteger(NUMBER)} · ${formatPercent(0.0525)}`,
    currency: () => formatMoney(AMOUNT, site.currency),
    cents: () => `${formatMoney(120000, site.currency)} · ${formatMoney(129950, site.currency)}`,
    date: () => formatDate(now, site.timezone),
    time: () => formatTime(now, site.timezone),
  }

  const field = (key: keyof Settings) => {
    const { label, options } = CHOICES[key] as { label: string; options: { value: string; label: string }[] }
    const example = (value: string): string => sample({ ...settings, [key]: value }, examples[key])
    return (
      <div className="analytik-format-field">
        <Select
          label={label}
          value={settings[key]}
          options={options.map((option) => ({
            value: option.value,
            label: option.label,
            description: example(option.value),
          }))}
          onChange={(value) => update({ format: { ...settings, [key]: value } })}
        />
        <span className="analytik-field-hint">
          Looks like <strong>{example(settings[key])}</strong>
        </span>
      </div>
    )
  }

  return (
    <>
      <Card
        title="Numbers and money"
        description="How counts, rates and amounts are written in every view. Saved for every admin."
      >
        <div className="analytik-format-grid">
          {field('numbers')}
          {field('currency')}
          {field('cents')}
        </div>
      </Card>
      <Card title="Dates and times" description="Chart labels, the date range and the time of each visit and payment.">
        <div className="analytik-format-grid">
          {field('date')}
          {field('time')}
        </div>
      </Card>
      <Card title="Preview" description="A payment as the dashboard will show it.">
        <p className="analytik-format-preview">
          <strong>{formatMoney(AMOUNT, site.currency)}</strong>
          <span>{formatDateTime(now, site.timezone)}</span>
          <span>
            {formatNumber(NUMBER)} visitors · {formatPercent(0.0525)} converted
          </span>
        </p>
      </Card>
    </>
  )
}

const THEMES = [
  { value: 'system', label: 'Same as the page', description: 'Follows the page it sits on, or the system' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

/** Light or dark for the whole dashboard; saved with the other settings. */
export function ThemeSettings() {
  const { values, update } = usePreferences()
  return (
    <Card title="Theme" description="Light or dark for the whole dashboard. Saved for every admin.">
      <Select
        label="Theme"
        value={parseTheme(values.theme) ?? 'system'}
        options={THEMES}
        onChange={(value) => update({ theme: value === 'system' ? undefined : value })}
      />
    </Card>
  )
}
