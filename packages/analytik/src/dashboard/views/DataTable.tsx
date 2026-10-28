import { createContext, type ReactNode, useContext, useEffect, useId, useState } from 'react'

import type { Page } from '../../shared/types'
import type { Paging } from '../api'
import { requestKey, useDashboard } from '../context'
import { useResource } from '../data'
import { formatNumber } from '../format'
import { t } from '../i18n'
import { Icon } from '../icons'
import type { DateRange } from '../range'
import { Card, Status } from '../ui'
import { DateRangePicker } from '../ui/date-picker'
import { Select } from '../ui/select'

export interface Column<T> {
  key: string
  label: string
  /** The list's sort key; makes the heading a sort button. */
  sort?: string
  /** Right-aligned, for numbers. */
  numeric?: boolean
  render: (row: T) => ReactNode
}

export interface TableFilter {
  key: string
  label: string
  /** A select of these, where `''` is "all". Without options the filter is set from a cell and shows as a chip. */
  options?: readonly { value: string; label: string }[]
  /** How a chip shows its value. */
  format?: (value: string) => string
}

const FilterContext = createContext<((key: string, value: string) => void) | undefined>(undefined)

/** Sets one of the table's filters from inside a cell; undefined outside a table. */
export const useTableFilter = () => useContext(FilterContext)

/** What a table asks its loader for: the range, paging, order, search and the filter values that are set. */
export interface TableRequest
  extends Required<Pick<Paging, 'offset' | 'limit'>>, Pick<Paging, 'sort' | 'order' | 'search'> {
  from: number
  to: number
  filters: Record<string, string>
}

export interface DataTableProps<T> {
  title: string
  columns: readonly Column<T>[]
  load: (request: TableRequest) => Promise<Page<T>>
  rowKey: (row: T) => string
  /** Names what the loader depends on besides the table's own state; a change goes back to the first page. */
  basis: string
  filters?: readonly TableFilter[]
  searchLabel: string
  empty: string
  /** Makes rows open something, e.g. the visit they belong to. */
  onOpen?: (row: T) => void
  /** Text for the row button's accessible name. */
  openLabel?: (row: T) => string
}

const PAGE_SIZES = [10, 25, 50, 100] as const
const SEARCH_DELAY_MS = 250

interface SortState {
  key: string
  order: 'asc' | 'desc'
}

/** Page numbers around the current one, with gaps (`null`) where pages are skipped. */
export function pageNumbers(current: number, count: number): (number | null)[] {
  const shown = new Set([0, count - 1, current - 1, current, current + 1].filter((p) => p >= 0 && p < count))
  const sorted = [...shown].sort((a, b) => a - b)
  const out: (number | null)[] = []
  for (const page of sorted) {
    const last = out.at(-1)
    if (last != null && page - last > 1) out.push(null)
    out.push(page)
  }
  return out
}

/**
 * A server-paged table: search, filters, its own date range within the dashboard's, sortable columns and numbered
 * pages. While the next page loads, the current one stays and dims.
 */
export function DataTable<T>({
  title,
  columns,
  load,
  rowKey,
  basis,
  filters = [],
  searchLabel,
  empty,
  onOpen,
  openLabel,
}: DataTableProps<T>) {
  const { range } = useDashboard()
  const searchId = useId()
  const [typed, setTyped] = useState('')
  const [search, setSearch] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [sort, setSort] = useState<SortState>()
  const [pageSize, setPageSize] = useState<number>(25)
  const [ownRange, setOwnRange] = useState<DateRange>()
  const shownRange = ownRange ?? range

  // Anything that changes the rows starts again at the first page.
  const filterKey = JSON.stringify([basis, search, values, sort, pageSize, shownRange.from, shownRange.to])
  const [paging, setPaging] = useState({ key: filterKey, page: 0 })
  const page = paging.key === filterKey ? paging.page : 0

  useEffect(() => {
    const timer = setTimeout(() => setSearch(typed.trim()), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [typed])

  const set = Object.fromEntries(Object.entries(values).filter(([, value]) => value))
  const rows = useResource(requestKey('table', title, filterKey, page), () =>
    load({
      from: shownRange.from,
      to: shownRange.to,
      offset: page * pageSize,
      limit: pageSize,
      sort: sort?.key,
      order: sort?.order,
      search: search || undefined,
      filters: set,
    }),
  )
  const data = rows.data
  const total = data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const first = total ? page * pageSize + 1 : 0
  const narrowed = !!search || Object.keys(set).length > 0 || !!ownRange
  const goTo = (next: number): void => setPaging({ key: filterKey, page: next })
  const setFilter = (key: string, value: string): void => setValues((current) => ({ ...current, [key]: value }))
  const toggleSort = (key: string): void =>
    setSort(sort?.key !== key ? { key, order: 'desc' } : sort.order === 'desc' ? { key, order: 'asc' } : undefined)
  const clear = (): void => {
    setTyped('')
    setSearch('')
    setValues({})
    setOwnRange(undefined)
  }

  return (
    <Card
      title={title}
      actions={
        data && (
          <span className="analytik-count" aria-label={t('{count} in total', { count: formatNumber(total) })}>
            {formatNumber(total)}
          </span>
        )
      }
    >
      <div className="analytik-table-tools">
        <label className="analytik-search" htmlFor={searchId}>
          <Icon name="search" />
          <span className="analytik-sr-only">{searchLabel}</span>
          <input
            id={searchId}
            className="analytik-input"
            type="search"
            placeholder={searchLabel}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        </label>
        {filters.map((filter) =>
          filter.options ? (
            <Select
              key={filter.key}
              label={filter.label}
              hideLabel
              className="analytik-pill"
              value={values[filter.key] ?? ''}
              options={filter.options}
              onChange={(value) => setFilter(filter.key, value)}
            />
          ) : (
            values[filter.key] && (
              <span key={filter.key} className="analytik-chip analytik-filter-chip">
                {filter.label}
                <strong>{filter.format?.(values[filter.key] ?? '') ?? values[filter.key]}</strong>
                <button
                  type="button"
                  className="analytik-chip-remove"
                  aria-label={t('Remove the {filter} filter', { filter: filter.label.toLowerCase() })}
                  onClick={() => setFilter(filter.key, '')}
                >
                  <Icon name="close" />
                </button>
              </span>
            )
          ),
        )}
        <DateRangePicker range={shownRange} onChange={setOwnRange} />
        {narrowed && (
          <button type="button" className="analytik-link" onClick={clear}>
            {t('Clear')}
          </button>
        )}
      </div>
      <Status loading={!data} error={rows.error}>
        <FilterContext value={setFilter}>
          {data?.items.length ? (
            <div className="analytik-table-wrap">
              <table className="analytik-table" aria-busy={rows.loading} aria-label={title}>
                <thead>
                  <tr>
                    {columns.map((column) => {
                      const sorted = column.sort && sort?.key === column.sort ? sort.order : undefined
                      return (
                        <th
                          key={column.key}
                          scope="col"
                          className={column.numeric ? 'analytik-num' : undefined}
                          aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                        >
                          {column.sort ? (
                            <button
                              type="button"
                              className="analytik-sort"
                              data-sorted={sorted}
                              onClick={() => toggleSort(column.sort ?? column.key)}
                            >
                              {column.label}
                              <Icon name={sorted === 'asc' ? 'up' : 'down'} />
                            </button>
                          ) : (
                            column.label
                          )}
                        </th>
                      )
                    })}
                    {onOpen && (
                      <th scope="col" className="analytik-open-cell">
                        <span className="analytik-sr-only">{t('Open')}</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => (
                    <tr key={rowKey(row)} data-open={onOpen ? '' : undefined} onClick={onOpen && (() => onOpen(row))}>
                      {columns.map((column) => (
                        <td key={column.key} className={column.numeric ? 'analytik-num' : undefined}>
                          {column.render(row)}
                        </td>
                      ))}
                      {onOpen && (
                        <td className="analytik-open-cell">
                          <button
                            type="button"
                            className="analytik-row-button"
                            aria-label={openLabel?.(row) ?? t('Open')}
                            onClick={(event) => {
                              event.stopPropagation()
                              onOpen(row)
                            }}
                          >
                            <Icon name="next" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="analytik-empty">
              <p>{narrowed ? t('Nothing matches these filters') : empty}</p>
              {narrowed && (
                <button type="button" className="analytik-button" onClick={clear}>
                  {t('Clear filters')}
                </button>
              )}
            </div>
          )}
          {total > 0 && (
            <nav className="analytik-pager" aria-label={t('{title} pages', { title })}>
              <span className="analytik-muted">
                {t('{from}–{to} of {total}', {
                  from: formatNumber(first),
                  to: formatNumber(Math.min(total, first + pageSize - 1)),
                  total: formatNumber(total),
                })}
              </span>
              <Select
                label={t('Rows per page')}
                hideLabel
                className="analytik-pill"
                value={String(pageSize)}
                options={PAGE_SIZES.map((size) => ({ value: String(size), label: t('{size} per page', { size }) }))}
                onChange={(size) => setPageSize(Number(size))}
              />
              <span className="analytik-pages">
                <button
                  type="button"
                  className="analytik-pill-icon"
                  aria-label={t('Previous page')}
                  disabled={page === 0}
                  onClick={() => goTo(page - 1)}
                >
                  <Icon name="prev" />
                </button>
                {pageNumbers(page, pages).map((number, index) =>
                  number === null ? (
                    <span key={`gap-${index}`} className="analytik-muted" aria-hidden="true">
                      …
                    </span>
                  ) : (
                    <button
                      key={number}
                      type="button"
                      className="analytik-page"
                      aria-current={number === page ? 'page' : undefined}
                      aria-label={t('Page {number}', { number: number + 1 })}
                      onClick={() => goTo(number)}
                    >
                      {number + 1}
                    </button>
                  ),
                )}
                <button
                  type="button"
                  className="analytik-pill-icon"
                  aria-label={t('Next page')}
                  disabled={page >= pages - 1}
                  onClick={() => goTo(page + 1)}
                >
                  <Icon name="next" />
                </button>
              </span>
            </nav>
          )}
        </FilterContext>
      </Status>
    </Card>
  )
}
