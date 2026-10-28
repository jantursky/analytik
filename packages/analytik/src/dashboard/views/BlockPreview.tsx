import type { ReactNode } from 'react'

import { Flag } from '../flags'
import { Icon } from '../icons'
import { msg, t } from '../i18n'
import type { BlockId } from './blocks'

// Made-up numbers for the picker: each block drawn small, the way it looks with data, so a block can be chosen by
// what it shows. Nothing here is fetched.

type Row = [label: string, value: string, share: number, country?: string]

const ROWS: Partial<Record<BlockId, Row[]>> = {
  sources: [
    ['Organic Search', '4,812', 1],
    ['Direct', '3,120', 0.65],
    ['Referral', '1,204', 0.25],
    ['Email', '642', 0.13],
  ],
  locations: [
    ['United States', '3,921', 1, 'US'],
    ['Germany', '1,610', 0.41, 'DE'],
    ['United Kingdom', '1,102', 0.28, 'GB'],
    ['France', '804', 0.2, 'FR'],
  ],
  pages: [
    ['/pricing', '2,940', 1],
    ['/', '2,610', 0.89],
    ['/docs', '1,480', 0.5],
    ['/blog/launch', '720', 0.24],
  ],
  technology: [
    ['Chrome', '5,120', 1],
    ['Safari', '2,340', 0.46],
    ['Firefox', '610', 0.12],
    ['Edge', '402', 0.08],
  ],
  goals: [
    ['signup', '412', 1],
    ['checkout', '268', 0.65],
    ['newsletter', '190', 0.46],
    ['trial_click', '96', 0.23],
  ],
  campaigns: [
    ['spring_sale', '1,240', 1],
    ['newsletter_42', '860', 0.69],
    ['launch_week', '512', 0.41],
    ['partner', '210', 0.17],
  ],
  'revenue-sources': [
    ['Organic Search', '€1,420', 1],
    ['Direct', '€890', 0.63],
    ['Email', '€610', 0.43],
    ['Referral', '€290', 0.2],
  ],
  'revenue-countries': [
    ['United States', '€1,980', 1, 'US'],
    ['Germany', '€740', 0.37, 'DE'],
    ['United Kingdom', '€420', 0.21, 'GB'],
    ['France', '€210', 0.11, 'FR'],
  ],
}

const AREA = 'M0 40 C14 30 22 34 34 26 S56 12 70 18 S94 8 120 4 L120 48 L0 48 Z'
const LINE = 'M0 40 C14 30 22 34 34 26 S56 12 70 18 S94 8 120 4'
const SPARK = 'M0 14 C8 10 14 12 20 8 S32 4 40 6'

/** Puts a node where a translated sentence has its `{name}` placeholder, so markup can sit inside one key. */
export function withNode(text: string, name: string, node: ReactNode): ReactNode {
  const [before = '', ...after] = text.split(`{${name}}`)
  return (
    <>
      {before}
      {after.length > 0 && node}
      {after.join(`{${name}}`)}
    </>
  )
}

function Bars({ rows, money }: { rows: Row[]; money?: boolean }) {
  return (
    <ul className="analytik-preview-bars" data-metric={money ? 'revenue' : undefined}>
      {rows.map(([label, value, share, country]) => (
        <li key={label}>
          <span>
            {country && <Flag code={country} />}
            {label}
          </span>
          <strong>{value}</strong>
          <i style={{ width: `${share * 100}%` }} />
        </li>
      ))}
    </ul>
  )
}

function Spark() {
  return (
    <svg viewBox="0 0 40 18" className="analytik-preview-spark">
      <path d={SPARK} />
    </svg>
  )
}

function Figure({ label, value, change }: { label: string; value: string; change: string }) {
  return (
    <span className="analytik-preview-number">
      <span>{t(label)}</span>
      <strong>{value}</strong>
      <em data-trend={change.startsWith('-') ? 'down' : 'up'}>{change}</em>
    </span>
  )
}

const PREVIEWS: Partial<Record<BlockId, () => ReactNode>> = {
  summary: () => (
    <>
      <span className="analytik-preview-row">
        <Figure label={msg('Visitors')} value="12.4k" change="+8%" />
        <Figure label={msg('Revenue')} value="€3,210" change="+12%" />
        <Figure label={msg('Conversion')} value="2.4%" change="-0.3%" />
      </span>
      <svg viewBox="0 0 120 48" preserveAspectRatio="none" className="analytik-preview-chart">
        {[10, 18, 8, 24, 14, 30].map((height, i) => (
          <rect key={i} x={i * 20 + 7} y={48 - height} width="6" height={height} />
        ))}
        <path className="area" d={AREA} />
        <path className="line" d={LINE} />
      </svg>
    </>
  ),
  kpis: () => (
    <span className="analytik-preview-tiles">
      {[
        [msg('Visitors'), '12.4k', '+8%'],
        [msg('Pageviews'), '38.1k', '+5%'],
        [msg('Sessions'), '15.9k', '+7%'],
        [msg('Revenue'), '€3.2k', '+12%'],
      ].map(([label = '', value = '', change = '']) => (
        <span key={label} className="analytik-preview-tile">
          <Figure label={label} value={value} change={change} />
          <Spark />
        </span>
      ))}
    </span>
  ),
  channels: () => (
    <table className="analytik-preview-table">
      <thead>
        <tr>
          <th>{t('Channel')}</th>
          <th>{t('Visitors')}</th>
          <th>{t('Conv.')}</th>
          <th>{t('Revenue')}</th>
        </tr>
      </thead>
      <tbody>
        {[
          ['Organic Search', '4,812', '3.1%', '€1,420'],
          ['Direct', '3,120', '2.4%', '€890'],
          ['Email', '642', '5.8%', '€610'],
          ['Referral', '1,204', '1.2%', '€290'],
        ].map(([channel = '', ...cells]) => (
          <tr key={channel}>
            <td>{channel}</td>
            {cells.map((cell, i) => (
              <td key={i}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
  devices: () => (
    <span className="analytik-preview-donut">
      <svg viewBox="0 0 42 42">
        <circle className="track" cx="21" cy="21" r="15.9" />
        <circle className="a" cx="21" cy="21" r="15.9" strokeDasharray="61 39" strokeDashoffset="25" />
        <circle className="b" cx="21" cy="21" r="15.9" strokeDasharray="35 65" strokeDashoffset="-36" />
      </svg>
      <span className="analytik-preview-legend">
        <span data-series="a">
          {t('Desktop')} <strong>61%</strong>
        </span>
        <span data-series="b">
          {t('Mobile')} <strong>35%</strong>
        </span>
        <span>
          {t('Tablet')} <strong>4%</strong>
        </span>
      </span>
    </span>
  ),
  funnel: () => (
    <ul className="analytik-preview-funnel">
      {(
        [
          ['/', '1,000', 1],
          ['/pricing', '540', 0.54],
          ['signup', '212', 0.21],
          ['checkout', '96', 0.1],
        ] as const
      ).map(([step, value, share]) => (
        <li key={step}>
          <span>{step}</span>
          <span className="analytik-preview-track">
            <i style={{ width: `${share * 100}%` }} />
          </span>
          <strong>{value}</strong>
        </li>
      ))}
    </ul>
  ),
  'order-value': () => (
    <span className="analytik-preview-big">
      <span className="analytik-kpi-icon">
        <Icon name="coin" />
      </span>
      <strong>€42.80</strong>
      <span>{t('{count, plural, one {from # order} other {from # orders}}', { count: 75 })}</span>
      <em data-trend="up">+6%</em>
    </span>
  ),
  payments: () => (
    <ul className="analytik-preview-feed">
      {[
        ['Anna Kováč', '€99.00', msg('2m ago')],
        ['Lukas Meyer', '€29.00', msg('1h ago')],
        ['cus_8fK2', '€49.00', msg('3h ago')],
        [msg('Refund'), '-€29.00', msg('5h ago')],
      ].map(([who = '', amount = '', ago]) => (
        <li key={who}>
          <span className="analytik-preview-avatar" aria-hidden="true">
            {who.charAt(0)}
          </span>
          <span>{t(who)}</span>
          <strong data-refund={amount.startsWith('-') ? '' : undefined}>{amount}</strong>
          <em>{t(ago ?? '')}</em>
        </li>
      ))}
    </ul>
  ),
  live: () => (
    <>
      <span className="analytik-preview-live">
        <span className="analytik-live-dot" aria-hidden="true" />
        <strong>7</strong> {t('{count, plural, one {visitor right now} other {visitors right now}}', { count: 7 })}
      </span>
      <ul className="analytik-preview-feed">
        {[
          ['Germany', '/pricing', msg('12s ago')],
          ['United States', '/docs', msg('40s ago')],
          ['France', '/', msg('1m ago')],
        ].map(([country = '', page, ago]) => (
          <li key={country}>
            <span>{withNode(t('Visitor from {country} visited {page}', { country }), 'page', <b>{page}</b>)}</span>
            <em>{t(ago ?? '')}</em>
          </li>
        ))}
      </ul>
    </>
  ),
}

/** A block drawn small with made-up numbers, for the picker. */
export function BlockPreview({ id }: { id: BlockId }) {
  const rows = ROWS[id]
  return (
    <span className="analytik-preview" aria-hidden="true">
      {rows ? <Bars rows={rows} money={id.startsWith('revenue')} /> : PREVIEWS[id]?.()}
    </span>
  )
}
