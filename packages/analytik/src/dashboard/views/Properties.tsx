import { useState } from 'react'

import { requestKey, useDashboard } from '../context'
import { useResource } from '../data'
import { formatNumber } from '../format'
import { t } from '../i18n'
import { BarList } from '../charts'
import { Card, Status } from '../ui'
import { Select } from '../ui/select'

const PROP = 'prop:'
/** The row that sums the values beyond the server's cap; it names no value, so a click does nothing. */
const OTHER = '\u0000other'
const MAX_ROWS = 51

/**
 * The custom properties of the goal in the filter: pick a key and see its values; a click on a value filters the
 * whole dashboard to the goal events that carry it. Shown only while a goal is filtered.
 */
export function Properties() {
  const { client, site, query, filters, addFilter } = useDashboard()
  const name = filters.goal ?? filters.event
  const [picked, setPicked] = useState('')
  const keys = useResource(requestKey('property-keys', site.id, query, name), () =>
    name ? client.properties(site.id, query, { name }) : Promise.resolve(null),
  )
  const list = keys.data?.keys ?? []
  const key = list.some((row) => row.key === picked) ? picked : (list[0]?.key ?? '')
  const values = useResource(requestKey('property-values', site.id, query, name, key), () =>
    name && key ? client.properties(site.id, query, { name, key }) : Promise.resolve(null),
  )
  if (!name) return null
  const result = values.data
  return (
    <Card
      title={t('Properties of “{name}”', { name })}
      actions={
        list.length > 1 ? (
          <Select
            label={t('Properties of “{name}”', { name })}
            hideLabel
            value={key}
            options={list.map((row) => ({ value: row.key, label: row.key }))}
            onChange={setPicked}
          />
        ) : undefined
      }
    >
      <Status loading={!keys.data && !keys.error} error={keys.error ?? values.error}>
        <BarList
          label={t('{dimension} by visitors', { dimension: key })}
          rows={[
            ...(result?.values ?? []).map((row) => ({ key: row.value, value: row.visitors })),
            ...(result?.other ? [{ key: OTHER, label: t('Other'), value: result.other.visitors }] : []),
          ]}
          formatValue={formatNumber}
          onSelect={(value) => value !== OTHER && addFilter(`${PROP}${key}`, value)}
          limit={MAX_ROWS}
          metric="visitors"
        />
      </Status>
    </Card>
  )
}
