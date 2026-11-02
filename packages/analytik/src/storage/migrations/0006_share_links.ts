import type { ColumnTypes } from './0001_init'

/**
 * Read-only share links. Only the SHA-256 of a token is stored, so a copy of the database cannot open a link. `views`
 * holds the dashboard views the link may show as JSON text (an empty list means all); `revoked_at` ends a link at once.
 */
export const shareLinks = ({ big }: Pick<ColumnTypes, 'big'>): string => `
CREATE TABLE IF NOT EXISTS share_links (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  views TEXT NOT NULL DEFAULT '[]',
  created_at ${big} NOT NULL,
  expires_at ${big},
  revoked_at ${big}
);
CREATE UNIQUE INDEX IF NOT EXISTS share_links_token ON share_links (token_hash);
CREATE INDEX IF NOT EXISTS share_links_site ON share_links (site_id);
`
