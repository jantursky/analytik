import type { ColumnTypes } from './0001_init'

/**
 * Core Web Vitals of sampled page loads: one row per report, with the page path and the three metrics (milliseconds,
 * and a score for layout shift). No visitor or session id, so a report says nothing about who sent it. `vitals_sample`
 * is the share of page views, in percent, the site measures; 0 (the default) turns it off.
 */
export const vitals = ({ big, real }: ColumnTypes): string => `
CREATE TABLE IF NOT EXISTS vitals (
  site_id TEXT NOT NULL,
  ts ${big} NOT NULL,
  path TEXT NOT NULL,
  lcp ${real},
  inp ${real},
  cls ${real}
);
CREATE INDEX IF NOT EXISTS vitals_site_ts ON vitals (site_id, ts);
ALTER TABLE sites ADD COLUMN vitals_sample INTEGER NOT NULL DEFAULT 0;
`
