import type { ColumnTypes } from './0001_init'

/**
 * API keys for scripts and tools. Only the SHA-256 of a secret is stored. `site_ids` is a JSON list (empty means all
 * sites). `previous_hash` and `previous_until` keep a rolled key's old secret alive for a grace period. The events table
 * is the audit log, trimmed to the newest rows.
 */
export const apiKeys = ({ big }: Pick<ColumnTypes, 'big'>): string => `
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL DEFAULT '',
  token_hash TEXT NOT NULL,
  prefix TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'read',
  site_ids TEXT NOT NULL DEFAULT '[]',
  created_at ${big} NOT NULL,
  expires_at ${big},
  last_used_at ${big},
  disabled_at ${big},
  previous_hash TEXT,
  previous_until ${big}
);
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_token ON api_keys (token_hash);
CREATE INDEX IF NOT EXISTS api_keys_previous ON api_keys (previous_hash);
CREATE TABLE IF NOT EXISTS api_key_events (
  id TEXT PRIMARY KEY,
  at ${big} NOT NULL,
  key_id TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS api_key_events_at ON api_key_events (at);
`
