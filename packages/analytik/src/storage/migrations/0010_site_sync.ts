/**
 * What a site takes over from its own website: a theme colour for its tile, whether its name came from the page
 * (`name_synced`, so a name typed by hand can be told apart), and the hash of its stored icon. The icon itself lives
 * in `site_icons`, as base64 text, so it is not loaded with every `SELECT * FROM sites` on the ingest path.
 */
export const siteSync = (): string => `
ALTER TABLE sites ADD COLUMN color TEXT;
ALTER TABLE sites ADD COLUMN name_synced INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sites ADD COLUMN icon_hash TEXT;
CREATE TABLE IF NOT EXISTS site_icons (
  site_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  data TEXT NOT NULL,
  hash TEXT NOT NULL,
  fetched_at BIGINT NOT NULL
);
`
