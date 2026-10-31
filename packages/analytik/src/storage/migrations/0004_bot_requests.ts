import type { ColumnTypes } from './0001_init'

/**
 * Crawler requests reported by a site's backend. Kept apart from sessions and events so they never reach the
 * visitor or revenue numbers. No IP address, raw user agent or query string is stored.
 */
export const botRequests = ({ big }: Pick<ColumnTypes, 'big'>): string => `
CREATE TABLE IF NOT EXISTS bot_requests (
  site_id TEXT NOT NULL,
  ts ${big} NOT NULL,
  crawler TEXT NOT NULL,
  category TEXT NOT NULL,
  path TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bot_requests_site_ts ON bot_requests (site_id, ts);
`
