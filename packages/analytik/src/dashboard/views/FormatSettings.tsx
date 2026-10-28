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
import { LANGUAGES, msg, t } from '../i18n'
import { parseTheme, usePreferences } from '../preferences'
import { Card } from '../ui'
import { Select } from '../ui/select'

// Shown in each option and under each select, written the way the option would write them.
const AMOUNT = 123456789
const NUMBER = 1234567

/** Text with a `\u0001` marker, shown with `strong` in the marker's place. */
function emphasized(text: string, strong: string) {
  const [head, tail] = text.split('\u0001')
  return (
    <>
      {head}
      <strong>{strong}</strong>
      {tail}
    </>
  )
}

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
    label: msg('Numbers'),
    options: [
      { value: 'auto', label: msg("The language's own") },
      { value: 'comma', label: msg('Comma groups, dot decimals') },
      { value: 'dot', label: msg('Dot groups, comma decimals') },
      { value: 'space', label: msg('Space groups, comma decimals') },
      { value: 'apostrophe', label: msg('Apostrophe groups, dot decimals') },
    ],
  },
  currency: {
    label: msg('Currency'),
    options: [
      { value: 'symbol', label: msg('Symbol') },
      { value: 'code', label: msg('Code') },
    ],
  },
  cents: {
    label: msg('Cents'),
    options: [
      { value: 'always', label: msg('Always') },
      { value: 'auto', label: msg('Only when there are some') },
    ],
  },
  date: {
    label: msg('Dates'),
    options: [
      { value: 'us', label: msg('Month first, in words') },
      { value: 'gb', label: msg('Day first, in words') },
      { value: 'dmy', label: msg('Day, month, year') },
      { value: 'mdy', label: msg('Month, day, year') },
      { value: 'iso', label: msg('ISO 8601') },
    ],
  },
  time: {
    label: msg('Time'),
    options: [
      { value: '12h', label: msg('12-hour clock') },
      { value: '24h', label: msg('24-hour clock') },
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
          label={t(label)}
          value={settings[key]}
          options={options.map((option) => ({
            value: option.value,
            label: t(option.label),
            description: example(option.value),
          }))}
          onChange={(value) => update({ format: { ...settings, [key]: value } })}
        />
        <span className="analytik-field-hint">
          {emphasized(t('Looks like {example}', { example: '\u0001' }), example(settings[key]))}
        </span>
      </div>
    )
  }

  return (
    <>
      <Card
        title={t('Numbers and money')}
        description={t('How counts, rates and amounts are written in every view. Saved for every admin.')}
      >
        <div className="analytik-format-grid">
          {field('numbers')}
          {field('currency')}
          {field('cents')}
        </div>
      </Card>
      <Card
        title={t('Dates and times')}
        description={t('Chart labels, the date range and the time of each visit and payment.')}
      >
        <div className="analytik-format-grid">
          {field('date')}
          {field('time')}
        </div>
      </Card>
      <Card title={t('Preview')} description={t('A payment as the dashboard will show it.')}>
        <div className="analytik-format-preview">
          <span>
            <small>{t('Payment')}</small>
            {formatMoney(AMOUNT, site.currency)}
          </span>
          <span>
            <small>{t('Date and time')}</small>
            {formatDateTime(now, site.timezone)}
          </span>
          <span>
            <small>{t('Visitors')}</small>
            {formatNumber(NUMBER)}
          </span>
          <span>
            <small>{t('Conversion rate')}</small>
            {formatPercent(0.0525)}
          </span>
        </div>
      </Card>
    </>
  )
}

const THEMES = [
  { value: 'system', label: msg('Same as the page'), description: msg('Follows the page it sits on, or the system') },
  { value: 'light', label: msg('Light') },
  { value: 'dark', label: msg('Dark') },
]

/** Light or dark for the whole dashboard, and the language; saved with the other settings. */
export function ThemeSettings() {
  const { values, update } = usePreferences()
  const language = LANGUAGES.some((l) => l.value === values.language) ? (values.language as string) : ''
  return (
    <>
      <Card title={t('Theme')} description={t('Light or dark for the whole dashboard. Saved for every admin.')}>
        <Select
          label={t('Theme')}
          value={parseTheme(values.theme) ?? 'system'}
          options={THEMES.map((o) => ({
            ...o,
            label: t(o.label),
            description: o.description && t(o.description),
          }))}
          onChange={(value) => update({ theme: value === 'system' ? undefined : value })}
        />
      </Card>
      <Card title={t('Language')} description={t('The language of the dashboard. Saved for every admin.')}>
        <div className="analytik-format-field">
          <Select
            label={t('Language')}
            value={language}
            options={[{ value: '', label: t('Browser language') }, ...LANGUAGES]}
            onChange={(value) => update({ language: value || undefined })}
          />
          <span className="analytik-field-hint">
            {t(
              'The dashboard follows your browser language unless you pick one. A `locale` prop on the embedded dashboard takes priority.',
            )}
          </span>
        </div>
      </Card>
    </>
  )
}
