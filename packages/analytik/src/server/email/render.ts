import type { BreakdownRow, Overview, Payment } from '../../shared/types'

/** Minor units as money in the currency's own digits, e.g. 4900 EUR → "€49.00", 4900 JPY → "¥4,900". */
export function money(amount: number, currency: string): string {
  try {
    const format = new Intl.NumberFormat('en-US', { style: 'currency', currency })
    return format.format(amount / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2))
  } catch {
    return `${(amount / 100).toFixed(2)} ${currency}`
  }
}

const integer = (value: number): string => Math.round(value).toLocaleString('en-US')
const percent = (value: number): string => `${(value * 100).toFixed(1)}%`

/** "+12%", "-3%" or "new" when there was nothing before. */
function change(value: number, previous: number): string {
  if (previous === 0) return value === 0 ? 'no change' : 'new'
  const relative = Math.round(((value - previous) / previous) * 100)
  return relative === 0 ? 'no change' : `${relative > 0 ? '+' : ''}${relative}%`
}

export const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)

/** A header value can't hold a line break. */
export const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

export interface SiteSummaryData {
  name: string
  domain: string
  overview: Overview
  sources: BreakdownRow[]
  pages: BreakdownRow[]
}

export interface SummaryData {
  kind: 'daily' | 'weekly'
  /** The period, as a date or a range of dates in the owner's time zone. */
  label: string
  sites: SiteSummaryData[]
  url: string | undefined
}

interface Line {
  label: string
  value: string
  change: string
}

function lines(overview: Overview): Line[] {
  const { currency } = overview
  const row = (label: string, d: Overview['visitors'], format: (n: number) => string): Line => ({
    label,
    value: format(d.value),
    change: change(d.value, d.previous),
  })
  return [
    row('Visitors', overview.visitors, integer),
    row('Revenue', overview.revenue, (n) => money(n, currency)),
    row('Conversion rate', overview.conversionRate, percent),
    row('Revenue per visitor', overview.revenuePerVisitor, (n) => money(n, currency)),
  ]
}

const topSources = (site: SiteSummaryData) =>
  site.sources
    .filter((row) => row.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 3)

const topPages = (site: SiteSummaryData) => [...site.pages].sort((a, b) => b.pageviews - a.pageviews).slice(0, 5)

export function summarySubject(data: SummaryData): string {
  return `Your ${data.kind} analytik summary, ${data.label}`
}

export function renderSummary(data: SummaryData): { text: string; html: string } {
  const text: string[] = [`${data.kind === 'daily' ? 'Daily' : 'Weekly'} summary, ${data.label}`, '']
  const html: string[] = [
    `<h2 style="margin:0 0 4px">${data.kind === 'daily' ? 'Daily' : 'Weekly'} summary</h2>`,
    `<p style="margin:0 0 16px;color:#666">${escapeHtml(data.label)}, compared with the period before</p>`,
  ]
  for (const site of data.sites) {
    const title = `${site.name} (${site.domain})`
    text.push(title, '-'.repeat(title.length))
    html.push(`<h3 style="margin:16px 0 6px">${escapeHtml(title)}</h3>`, '<table cellpadding="4" cellspacing="0">')
    for (const line of lines(site.overview)) {
      text.push(`${line.label}: ${line.value} (${line.change})`)
      html.push(
        `<tr><td>${escapeHtml(line.label)}</td><td><strong>${escapeHtml(line.value)}</strong></td><td style="color:#666">${escapeHtml(line.change)}</td></tr>`,
      )
    }
    html.push('</table>')
    const sources = topSources(site)
    if (sources.length > 0) {
      text.push('', 'Top sources by revenue')
      html.push('<p style="margin:10px 0 2px"><strong>Top sources by revenue</strong></p><ul style="margin:0">')
      for (const row of sources) {
        const value = money(row.revenue, site.overview.currency)
        text.push(`  ${row.key}: ${value}`)
        html.push(`<li>${escapeHtml(row.key)}: ${escapeHtml(value)}</li>`)
      }
      html.push('</ul>')
    }
    const pages = topPages(site)
    if (pages.length > 0) {
      text.push('', 'Top pages')
      html.push('<p style="margin:10px 0 2px"><strong>Top pages</strong></p><ul style="margin:0">')
      for (const row of pages) {
        text.push(`  ${row.key}: ${integer(row.pageviews)} views`)
        html.push(`<li>${escapeHtml(row.key)}: ${integer(row.pageviews)} views</li>`)
      }
      html.push('</ul>')
    }
    text.push('')
  }
  if (data.url) {
    text.push(`Open the dashboard: ${data.url}`)
    html.push(`<p style="margin-top:20px"><a href="${escapeHtml(data.url)}">Open the dashboard</a></p>`)
  }
  return { text: text.join('\n'), html: wrap(html.join('\n')) }
}

export function renderPayment(
  payment: Payment,
  site: { name: string; domain: string },
  source: string | null,
): { subject: string; text: string; html: string } {
  const amount = money(payment.amount, payment.currency)
  const lines = [`Site: ${site.name} (${site.domain})`, `Amount: ${amount}`, `Source: ${source ?? 'unknown'}`]
  if (payment.email) lines.push(`Customer: ${payment.email}`)
  return {
    subject: oneLine(`New payment of ${amount} on ${site.name}`),
    text: lines.join('\n'),
    html: wrap(
      `<h2 style="margin:0 0 8px">New payment of ${escapeHtml(amount)}</h2>` +
        lines.map((line) => `<p style="margin:2px 0">${escapeHtml(line)}</p>`).join('\n'),
    ),
  }
}

export function renderDown(
  site: { name: string; domain: string },
  lastEvent: number,
): { subject: string; text: string; html: string } {
  const last = new Date(lastEvent).toISOString()
  const text = `${site.name} (${site.domain}) has received no events for 24 hours. The last one arrived at ${last}.\n\nCheck that the tracking snippet is still on the site and the server is reachable.`
  return {
    subject: oneLine(`No events on ${site.name} for 24 hours`),
    text,
    html: wrap(
      `<h2 style="margin:0 0 8px">No events for 24 hours</h2>` +
        text
          .split('\n\n')
          .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
          .join('\n'),
    ),
  }
}

export function renderTest(): { subject: string; text: string; html: string } {
  const text = 'This is a test email from analytik. If you can read it, owner emails will reach you.'
  return { subject: 'analytik test email', text, html: wrap(`<p>${text}</p>`) }
}

const wrap = (body: string): string =>
  `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#111;max-width:560px">${body}</div>`
