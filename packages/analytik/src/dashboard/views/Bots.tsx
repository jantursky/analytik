import { useState } from 'react'

import type { BotCategory } from '../../shared/types'
import { AreaChart, BarList } from '../charts'
import { requestKey, useDashboard } from '../context'
import { useResource } from '../data'
import { formatBucket, formatDateTime, formatInteger, formatNumber } from '../format'
import { msg, t } from '../i18n'
import { Icon } from '../icons'
import { Card, Status } from '../ui'
import { View } from '../ui/motion'
import { Tabs } from '../ui/tabs'

const CATEGORY_LABELS: Record<BotCategory, string> = {
  answers: msg('AI answers'),
  indexing: msg('Indexing'),
  training: msg('Training'),
}

type Grouping = 'crawler' | 'page' | 'category'

const toggle = <T,>(list: readonly T[], value: T): T[] =>
  list.includes(value) ? list.filter((item) => item !== value) : [...list, value]

/** Crawler requests reported by the site's server, with filters that never touch the visitor numbers. */
export function Bots() {
  const { client, site, query, range, apiUrl } = useDashboard()
  const [crawlers, setCrawlers] = useState<string[]>([])
  const [categories, setCategories] = useState<BotCategory[]>([])
  const [pages, setPages] = useState<string[]>([])
  const [typed, setTyped] = useState('')
  const [grouping, setGrouping] = useState<Grouping>('crawler')
  const activePages = typed.trim() ? [...pages, typed.trim()] : pages
  const filters = { crawler: crawlers, category: categories, page: activePages }
  const result = useResource(requestKey('bots', site.id, query, filters), () => client.bots(site.id, query, filters))
  const data = result.data

  if (data && !data.hasData) {
    return (
      <View>
        <Card title={t('Track crawlers')}>
          <p>
            {t(
              'Crawlers do not run the tracker, so your server reports what they request. Send them with POST /api/v1/bots and the site API key. Crawlers are told apart by user agent only.',
            )}
          </p>
          <pre className="analytik-code">{`curl -X POST ${apiUrl.replace(/\/+$/, '')}/v1/bots \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '{"requests":[{"userAgent":"GPTBot/1.2","path":"/blog"}]}'`}</pre>
        </Card>
      </View>
    )
  }

  const chips = [
    ...crawlers.map((name) => ({ name, remove: () => setCrawlers(toggle(crawlers, name)) })),
    ...categories.map((name) => ({
      name: t(CATEGORY_LABELS[name]),
      remove: () => setCategories(toggle(categories, name)),
    })),
    ...pages.map((name) => ({ name, remove: () => setPages(toggle(pages, name)) })),
  ]
  const rows =
    grouping === 'crawler'
      ? (data?.crawlers ?? []).map((r) => ({ key: r.key, label: r.key, value: r.requests }))
      : grouping === 'page'
        ? (data?.pages ?? []).map((r) => ({ key: r.key, label: r.key, value: r.requests }))
        : (data?.categories ?? []).map((r) => ({ key: r.key, label: t(CATEGORY_LABELS[r.key]), value: r.requests }))
  const select = (key: string): void => {
    if (grouping === 'crawler') setCrawlers(toggle(crawlers, key))
    else if (grouping === 'page') setPages(toggle(pages, key))
    else setCategories(toggle(categories, key as BotCategory))
  }

  return (
    <View>
      <Card title={t('Bot requests')}>
        <div className="analytik-table-tools">
          <label className="analytik-search">
            <Icon name="search" />
            <span className="analytik-sr-only">{t('Filter pages, for example /blog/*')}</span>
            <input
              className="analytik-input"
              type="search"
              placeholder={t('Filter pages, for example /blog/*')}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && typed.trim()) {
                  setPages(toggle(pages, typed.trim()))
                  setTyped('')
                }
              }}
            />
          </label>
          {chips.map((chip) => (
            <button
              key={chip.name}
              type="button"
              className="analytik-chip"
              aria-label={t('Remove {name}', { name: chip.name })}
              onClick={chip.remove}
            >
              {chip.name}
            </button>
          ))}
        </div>
        <Status loading={!data} error={result.error}>
          {data && (
            <AreaChart
              label={t('Bot requests')}
              points={data.series.map((p) => ({ ts: p.ts, value: p.requests }))}
              formatValue={formatInteger}
              formatAxis={formatNumber}
              formatTime={(ts) => formatBucket(ts, range.interval, site.timezone)}
            />
          )}
        </Status>
      </Card>
      <Card title={t('Crawlers')} hideTitle>
        <Tabs
          label={t('Crawlers')}
          tabs={[
            { value: 'crawler', label: t('Crawlers') },
            { value: 'page', label: t('Pages') },
            { value: 'category', label: t('Category') },
          ]}
          value={grouping}
          onChange={setGrouping}
          extra={<span className="analytik-col-head">{t('Requests')}</span>}
        >
          <Status loading={!data} error={result.error}>
            <BarList
              label={t('Requests')}
              rows={rows}
              formatValue={formatNumber}
              onSelect={select}
              limit={50}
              metric="visitors"
            />
          </Status>
        </Tabs>
      </Card>
      <Card title={t('Recent requests')}>
        <Status loading={!data} error={result.error}>
          {data && data.recent.length > 0 && (
            <ul className="analytik-bars" aria-label={t('Recent requests')}>
              {data.recent.map((row, index) => (
                <li key={`${row.ts}-${index}`} className="analytik-bar">
                  <span className="analytik-bar-label">
                    <span className="analytik-muted">{formatDateTime(row.ts, site.timezone)}</span> {row.crawler}{' '}
                    <span className="analytik-mono">{row.path}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {data?.recent.length === 0 && <p className="analytik-empty">{t('No bot requests in this period')}</p>}
        </Status>
      </Card>
    </View>
  )
}
