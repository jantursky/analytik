import type { VitalMetric, VitalValues, VitalsResult } from '../../shared/types'
import { type VitalRating, rateVital } from '../../shared/vitals'
import { requestKey, useDashboard } from '../context'
import { useResource } from '../data'
import { formatNumber } from '../format'
import { msg, t } from '../i18n'
import { Card, Status } from '../ui'

const COLUMNS: readonly { metric: VitalMetric; short: string; name: string }[] = [
  { metric: 'lcp', short: 'LCP', name: 'Largest Contentful Paint' },
  { metric: 'inp', short: 'INP', name: 'Interaction to Next Paint' },
  { metric: 'cls', short: 'CLS', name: 'Cumulative Layout Shift' },
]

const RATINGS: Record<VitalRating, string> = {
  good: msg('Good'),
  'needs-work': msg('Needs work'),
  poor: msg('Poor'),
}

/** A metric as people read it: seconds for the loading time, milliseconds for responsiveness, a plain score for shift. */
export function formatVital(metric: VitalMetric, value: number): string {
  if (metric === 'cls') return String(value)
  if (metric === 'inp') return `${formatNumber(value)} ms`
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value / 1000)} s`
}

function Cell({ metric, value }: { metric: VitalMetric; value: number | null }) {
  if (value === null) return <td className="analytik-muted">—</td>
  const rating = rateVital(metric, value)
  return (
    // The rating is written out as well as coloured, so it does not rest on colour alone.
    <td data-rating={rating}>
      <span className="analytik-vital-value">{formatVital(metric, value)}</span>
      <span className="analytik-vital-rating">{t(RATINGS[rating])}</span>
    </td>
  )
}

function Row({ label, values }: { label: string; values: VitalValues }) {
  return (
    <tr>
      <th scope="row" className="analytik-vital-page">
        {label}
      </th>
      <td className="analytik-vital-count">{formatNumber(values.samples)}</td>
      {COLUMNS.map(({ metric }) => (
        <Cell key={metric} metric={metric} value={values[metric]} />
      ))}
    </tr>
  )
}

function VitalsTable({ result }: { result: VitalsResult }) {
  return (
    <div className="analytik-vitals-scroll">
      <table className="analytik-vitals">
        <thead>
          <tr>
            <th scope="col">{t('Page')}</th>
            <th scope="col">{t('Reports')}</th>
            {COLUMNS.map(({ metric, short, name }) => (
              <th key={metric} scope="col" title={name}>
                <abbr title={name}>{short}</abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <Row label={t('All pages')} values={result.total} />
          {result.pages.map((page) => (
            <Row key={page.path} label={page.path} values={page} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Core Web Vitals at the 75th percentile, for the site and per page, each with its rating. */
export function VitalsCard() {
  const { client, site, query } = useDashboard()
  const result = useResource<VitalsResult>(requestKey('vitals', site.id, query), () => client.vitals(site.id, query))
  const data = result.data
  return (
    <Card title={t('Core Web Vitals')} description={t('Three in four page loads are at least this good.')}>
      <Status loading={result.loading && !data} error={result.error}>
        {data &&
          (data.total.samples > 0 ? (
            <VitalsTable result={data} />
          ) : (
            <p className="analytik-empty">
              {data.enabled
                ? t('No measurements in this period')
                : t('Turn on Core Web Vitals in Settings → Tracking code to see them here.')}
            </p>
          ))}
      </Status>
    </Card>
  )
}

/** The card on a dashboard that may read it; a shared dashboard has no access to the vitals route. */
export function Vitals() {
  const { readOnly } = useDashboard()
  return readOnly ? null : <VitalsCard />
}
