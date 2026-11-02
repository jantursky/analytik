import type { ColumnTypes } from './0001_init'

/**
 * Dated notes on a site's charts ("launched on Product Hunt"). Kept apart from events so they never count in the
 * numbers and never cost a write on the tracker path.
 */
export const annotations = ({ big }: Pick<ColumnTypes, 'big'>): string => `
CREATE TABLE IF NOT EXISTS annotations (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  ts ${big} NOT NULL,
  text TEXT NOT NULL,
  created_at ${big} NOT NULL
);
CREATE INDEX IF NOT EXISTS annotations_site_ts ON annotations (site_id, ts);
`
