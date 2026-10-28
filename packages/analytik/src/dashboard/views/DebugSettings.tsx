import { useId, useState } from 'react'

import { mixVisits, TEST_SITE_MIX } from '../../shared/test-sites'
import type { TestDataInput, TestDataResult } from '../../shared/types'
import { useDashboard } from '../context'
import { formatInteger, formatNumber } from '../format'
import { msg, t } from '../i18n'
import { Actions, Card, ConfirmButton, Field, useOutcome } from '../ui'
import { CurrencySelect } from '../ui/currency'
import { Select } from '../ui/select'

/** The server's limit on one call; the form checks it first so the request isn't refused after the click. */
const MAX_VISITS = 1_000_000
// A visit averages a little under three events: its pageviews plus the odd goal or outbound click.
const EVENTS_PER_VISIT = 2.8

interface Amounts {
  sites: number
  days: number
  visitorsPerDay: number
  priceScale: number
  /** Each new site gets its own kind of traffic from the realistic mix. */
  mix?: boolean
}

const PRESETS: { value: string; label: string; hint: string; amounts: Amounts }[] = [
  {
    value: 'small',
    label: msg('Small'),
    hint: msg('A month of a quiet site.'),
    amounts: { sites: 1, days: 30, visitorsPerDay: 200, priceScale: 1 },
  },
  {
    value: 'busy',
    label: msg('Busy'),
    hint: msg('A quarter at 3,000 visits a day.'),
    amounts: { sites: 1, days: 90, visitorsPerDay: 3000, priceScale: 1 },
  },
  {
    value: 'many',
    label: msg('Many sites'),
    hint: msg('Twelve sites with a month each, for the sites overview.'),
    amounts: { sites: 12, days: 30, visitorsPerDay: 400, priceScale: 1 },
  },
  {
    value: 'mix',
    label: msg('Realistic mix'),
    hint: msg('Ten different sites over two months: empty, quiet, just launched, paused, a busy shop.'),
    amounts: { sites: TEST_SITE_MIX.length, days: 60, visitorsPerDay: 400, priceScale: 1, mix: true },
  },
  {
    value: 'money',
    label: msg('Big money'),
    hint: msg('Prices 10,000 times higher: revenue in the millions.'),
    amounts: { sites: 1, days: 90, visitorsPerDay: 1000, priceScale: 10_000 },
  },
  {
    value: 'stress',
    label: msg('Stress test'),
    hint: msg('Two years at 1,300 visits a day: close to a million visits.'),
    amounts: { sites: 1, days: 730, visitorsPerDay: 1300, priceScale: 1 },
  },
]

const CUSTOM = 'custom'

type Target = 'new' | 'current'

const seconds = (ms: number): string => t('{n} s', { n: (ms / 1000).toFixed(ms < 10_000 ? 1 : 0) })

function summary(result: TestDataResult): string {
  const { visitors, sessions, events, payments } = result.counts
  const count = result.sites.length
  if (sessions === 0) {
    return count === 1
      ? t('Made {name}', { name: result.sites[0]?.name ?? '' })
      : t('Made {count} empty sites', { count: formatInteger(count) })
  }
  const params = {
    sessions: formatInteger(sessions),
    visitors: formatInteger(visitors),
    events: formatInteger(events),
    payments: formatInteger(payments),
    time: seconds(result.durationMs),
  }
  return count === 1
    ? t(
        'Added {sessions} visits from {visitors} visitors, {events} events and {payments} payments to {where} in {time}',
        {
          ...params,
          where: result.sites[0]?.name ?? '',
        },
      )
    : t(
        'Added {sessions} visits from {visitors} visitors, {events} events and {payments} payments to {where} in {time}',
        {
          ...params,
          where: t('{count} sites', { count: formatInteger(count) }),
        },
      )
}

/** What a run would write, before it starts. */
function estimate(visits: number, sites: number, mixed: boolean): string {
  const slow = visits > 200_000 ? ` ${t('A run this big takes a minute or more; keep this tab open.')}` : ''
  if (mixed) {
    const kinds = TEST_SITE_MIX.slice(0, sites).map(
      (profile) => profile.name.charAt(0).toLowerCase() + profile.name.slice(1),
    )
    const more = sites > TEST_SITE_MIX.length ? t(', then the same kinds again') : ''
    const what = sites === 1 ? t('One site') : t('{count} different sites', { count: formatInteger(sites) })
    return `${t('{what} ({kinds}{more}): about {visits} visits.', { what, kinds: kinds.join(', '), more, visits: formatNumber(visits) })}${slow}`
  }
  if (visits === 0) {
    return sites === 1
      ? t('An empty site with no visits yet, to see the dashboard before any data arrives.')
      : t('{count} empty sites with no visits yet, to see the dashboard before any data arrives.', {
          count: formatInteger(sites),
        })
  }
  return `${t('About {visits} visits and {events} events.', { visits: formatNumber(visits), events: formatNumber(Math.round(visits * EVENTS_PER_VISIT)) })}${slow}`
}

/** A whole number from an input, or NaN while it's empty or not one. */
const whole = (text: string): number => (/^\d+$/.test(text.trim()) ? Number(text) : Number.NaN)

/**
 * Generates made-up traffic and payments in bulk, to try the dashboard with many sites, long histories and large
 * numbers. Settings lists it only when the server was started with `debug: true`.
 */
export function DebugSettings() {
  return (
    <>
      <TestDataGenerator />
      <TestSiteCleanup />
    </>
  )
}

function TestDataGenerator() {
  const { client, site, onSiteChange } = useDashboard()
  const id = useId()
  const [preset, setPreset] = useState('small')
  const [target, setTarget] = useState<Target>('new')
  const [fields, setFields] = useState(() => {
    const amounts = PRESETS[0]?.amounts ?? { sites: 1, days: 30, visitorsPerDay: 200, priceScale: 1 }
    return {
      sites: String(amounts.sites),
      days: String(amounts.days),
      visitorsPerDay: String(amounts.visitorsPerDay),
      priceScale: String(amounts.priceScale),
    }
  })
  const [mix, setMix] = useState(false)
  const [currency, setCurrency] = useState(site.currency)
  const [busy, setBusy] = useState(false)
  const [outcome, run] = useOutcome()

  const choose = (value: string): void => {
    setPreset(value)
    const amounts = PRESETS.find((p) => p.value === value)?.amounts
    if (!amounts) return
    setMix(amounts.mix === true)
    setFields({
      sites: String(amounts.sites),
      days: String(amounts.days),
      visitorsPerDay: String(amounts.visitorsPerDay),
      priceScale: String(amounts.priceScale),
    })
  }
  const edit = (key: keyof typeof fields, value: string): void => {
    setFields({ ...fields, [key]: value })
    setPreset(CUSTOM)
  }

  const sites = target === 'current' ? 1 : whole(fields.sites)
  const days = whole(fields.days)
  // The mix sets traffic and prices per site, so only new sites take it.
  const mixed = mix && target === 'new'
  const visitorsPerDay = mixed ? 0 : whole(fields.visitorsPerDay)
  const priceScale = mixed ? 1 : Number(fields.priceScale)
  const visits = mixed ? mixVisits(sites, days) : sites * days * visitorsPerDay
  const problem =
    target === 'new' && !(sites >= 1 && sites <= 20)
      ? t('Make 1 to 20 sites.')
      : !(days >= 0 && days <= 730)
        ? t('Days go from 0 to 730.')
        : !(visitorsPerDay >= 0 && visitorsPerDay <= 100_000)
          ? t('Visits per day go from 0 to 100,000.')
          : !(priceScale > 0 && priceScale <= 100_000)
            ? t('The price multiplier goes up to 100,000.')
            : visits > MAX_VISITS
              ? t("That's {visits} visits; one run writes at most {max}.", {
                  visits: formatNumber(visits),
                  max: formatNumber(MAX_VISITS),
                })
              : visits === 0 && target === 'current'
                ? t('Zero visits leave this site as it is; pick new test sites for empty ones.')
                : null

  const generate = (): void => {
    const input: TestDataInput =
      target === 'current'
        ? { siteId: site.id, days, visitorsPerDay, priceScale }
        : mixed
          ? { sites, days, mix: true, currency }
          : { sites, days, visitorsPerDay, priceScale, currency }
    setBusy(true)
    run(
      client.generateTestData(input).finally(() => {
        setBusy(false)
        onSiteChange(site)
      }),
      summary,
    )
  }

  return (
    <Card
      title={t('Test data')}
      description={t(
        'Fills the database with made-up visits, goals and payments, to try the dashboard with many sites, long histories and large numbers. Each run adds to what is there.',
      )}
    >
      <fieldset className="analytik-choices">
        <legend className="analytik-field-label">{t('Preset')}</legend>
        <div className="analytik-choice-grid">
          {PRESETS.map((p) => (
            <label key={p.value} className="analytik-choice">
              <input
                type="radio"
                name={`${id}-preset`}
                value={p.value}
                checked={preset === p.value}
                onChange={() => choose(p.value)}
              />
              <span>
                <strong>{t(p.label)}</strong>
                <span className="analytik-field-hint">{t(p.hint)}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="analytik-row">
        <Select
          label={t('Write into')}
          value={target}
          options={[
            { value: 'new', label: t('New test sites') },
            { value: 'current', label: t('This site ({name})', { name: site.name }) },
          ]}
          onChange={setTarget}
        />
        {target === 'new' && (
          <Select
            label={t('Traffic')}
            value={mixed ? 'mix' : 'same'}
            options={[
              {
                value: 'same',
                label: t('Same on every site'),
                description: t('Every site gets the visits and prices below.'),
              },
              {
                value: 'mix',
                label: t('Realistic mix'),
                description: t('Each site differs: empty, quiet, average, busy, just launched, paused.'),
              },
            ]}
            onChange={(value) => {
              setMix(value === 'mix')
              setPreset(CUSTOM)
            }}
          />
        )}
        {target === 'new' && (
          <Field
            label={t('Sites')}
            hint={mixed ? t('1 to 20; each takes the next kind of site.') : t('1 to 20, named Test site …')}
          >
            <input
              className="analytik-input"
              type="number"
              inputMode="numeric"
              min={1}
              max={20}
              value={fields.sites}
              onChange={(e) => edit('sites', e.target.value)}
            />
          </Field>
        )}
        <Field label={t('Days of history')} hint={t('Ending now, up to 730; 0 for an empty site.')}>
          <input
            className="analytik-input"
            type="number"
            inputMode="numeric"
            min={0}
            max={730}
            value={fields.days}
            onChange={(e) => edit('days', e.target.value)}
          />
        </Field>
        {!mixed && (
          <Field label={t('Visits per day')} hint={t('Per site, weekends quieter; 0 for an empty site.')}>
            <input
              className="analytik-input"
              type="number"
              inputMode="numeric"
              min={0}
              max={100_000}
              value={fields.visitorsPerDay}
              onChange={(e) => edit('visitorsPerDay', e.target.value)}
            />
          </Field>
        )}
        {!mixed && (
          <Field label={t('Price multiplier')} hint={t('Plans cost 9, 29 and 99 times this.')}>
            <input
              className="analytik-input"
              type="number"
              inputMode="decimal"
              min={0.01}
              step="any"
              value={fields.priceScale}
              onChange={(e) => edit('priceScale', e.target.value)}
            />
          </Field>
        )}
        {target === 'new' && <CurrencySelect label={t('Currency')} value={currency} onChange={setCurrency} />}
      </div>
      <p className="analytik-debug-estimate" role="status" data-problem={problem ? '' : undefined}>
        {problem ?? estimate(visits, sites, mixed)}
      </p>
      <Actions outcome={outcome}>
        <button
          type="button"
          className="analytik-button"
          data-variant="primary"
          disabled={busy || problem !== null}
          aria-busy={busy || undefined}
          onClick={generate}
        >
          {busy ? t('Generating…') : t('Generate')}
        </button>
      </Actions>
    </Card>
  )
}

function TestSiteCleanup() {
  const { client, site, onSiteChange } = useDashboard()
  const [outcome, run] = useOutcome()
  return (
    <Card
      title={t('Remove test data')}
      description={t(
        'Deletes every site the generator made, with all of its data. Sites you added yourself stay, including data generated into them.',
      )}
    >
      <Actions outcome={outcome}>
        <ConfirmButton
          label={t('Delete test sites')}
          title={t('Delete all test sites?')}
          description={t('Every site the generator made, with its visits, events and payments, is removed for good.')}
          confirmLabel={t('Delete test sites')}
          onConfirm={() =>
            run(
              client.deleteTestSites().finally(() => onSiteChange(site)),
              ({ deleted }) =>
                t('{count, plural, one {Deleted # test site} other {Deleted # test sites}}', { count: deleted }),
            )
          }
        />
      </Actions>
    </Card>
  )
}
