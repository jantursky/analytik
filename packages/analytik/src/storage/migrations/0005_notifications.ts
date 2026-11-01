import type { ColumnTypes } from './0001_init'

/**
 * Owner emails: the settings chosen in the dashboard, and one row per email sent (a payment, a summary period, a
 * tracker outage), written before sending so an overlapping run can't send it twice. A row still `sending` after a while
 * belongs to a run that died, and the next run takes it over.
 */
export const notifications = ({ big }: Pick<ColumnTypes, 'big'>): string => `
CREATE TABLE IF NOT EXISTS notification_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at ${big} NOT NULL
);
CREATE TABLE IF NOT EXISTS notification_log (
  key TEXT PRIMARY KEY,
  sent_at ${big} NOT NULL,
  status TEXT NOT NULL DEFAULT 'sending'
);
`
