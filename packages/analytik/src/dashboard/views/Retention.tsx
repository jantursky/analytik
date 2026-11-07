import type { CSSProperties } from 'react'

import { RETENTION_WEEKS } from '../../shared/retention'
import type { RetentionCohort, RetentionResult } from '../../shared/types'
import { requestKey, useDashboard } from '../context'
import { useResource } from '../data'
import { formatDate, formatNumber, formatPercent } from '../format'
import { t } from '../i18n'
import { Card, Status } from '../ui'
import { View } from '../ui/motion'

/** The share of a cohort active `week` weeks after it began, or null when that week has not happened yet. */
const share = (cohort: RetentionCohort, week: number): number | null => {
  const active = cohort.active[week]
  return active === undefined || cohort.size === 0 ? null : active / cohort.size
}

function Heatmap({ result }: { result: RetentionResult }) {
  const weeks = Array.from({ length: RETENTION_WEEKS }, (_, week) => week).filter((week) =>
    result.cohorts.some((cohort) => share(cohort, week) !== null),
  )
  return (
    <div className="analytik-retention-scroll">
      <table className="analytik-retention">
        <caption className="analytik-sr-only">{t('Retention')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('Cohort')}</th>
            <th scope="col">{t('Visitors')}</th>
            {weeks.map((week) => (
              <th key={week} scope="col">
                {t('Week {week}', { week })}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.cohorts.map((cohort) => (
            <tr key={cohort.week}>
              <th scope="row">{formatDate(cohort.week, 'UTC', false)}</th>
              <td>{formatNumber(cohort.size)}</td>
              {weeks.map((week) => {
                const value = share(cohort, week)
                if (value === null) return <td key={week} className="analytik-retention-empty" />
                return (
                  <td
                    key={week}
                    className="analytik-retention-cell"
                    style={{ '--share': Math.min(1, value) } as CSSProperties}
                    title={t('{count} of {size} visitors', {
                      count: formatNumber(cohort.active[week] ?? 0),
                      size: formatNumber(cohort.size),
                    })}
                  >
                    {formatPercent(value)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Weekly cohorts of new visitors and the share of each that came back; only where visitors are recognised. */
export function Retention() {
  const { client, site, query } = useDashboard()
  const result = useResource<RetentionResult>(requestKey('retention', site.id, query), () =>
    client.retention(site.id, query),
  )
  const data = result.data
  return (
    <View>
      <Card
        title={t('Retention')}
        description={t('Weekly cohorts of new visitors and the share of each that came back in the weeks after.')}
      >
        <Status loading={result.loading && !data} error={result.error}>
          {data &&
            (!data.available ? (
              <p className="analytik-empty">
                {t(
                  'Retention needs visitors to be recognised across days. Choose the Persistent privacy mode in Settings to turn it on.',
                )}
              </p>
            ) : data.cohorts.length === 0 ? (
              <p className="analytik-empty">{t('No new visitors in this period.')}</p>
            ) : (
              <>
                <Heatmap result={data} />
                <p className="analytik-muted">
                  {t('Weeks start on Monday (UTC). Each row follows the visitors first seen that week.')}
                </p>
              </>
            ))}
        </Status>
      </Card>
    </View>
  )
}
