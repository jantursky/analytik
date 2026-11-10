import type { ColumnTypes } from './0001_init'

/**
 * Webhooks that receive goals and payments of a site. The signing secret is kept as text because signing needs it; the
 * API never returns it after creation. `events` is a JSON list (goal, payment), `format` is `json` or `chat`, and
 * `last_status` is the outcome of the last delivery that differed from the one before.
 */
export const outboundWebhooks = ({ big }: Pick<ColumnTypes, 'big'>): string => `
CREATE TABLE IF NOT EXISTS outbound_webhooks (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT '["goal","payment"]',
  format TEXT NOT NULL DEFAULT 'json',
  paused INTEGER NOT NULL DEFAULT 0,
  last_status TEXT,
  last_at ${big},
  created_at ${big} NOT NULL
);
CREATE INDEX IF NOT EXISTS outbound_webhooks_site ON outbound_webhooks (site_id);
`
