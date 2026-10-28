/**
 * Marks rows that came from another analytics tool. `imported` holds the source name and stays NULL for
 * rows the tracker recorded, so an import can be listed and removed without touching tracked data.
 */
export const imported = (): string => `
ALTER TABLE sessions ADD COLUMN imported TEXT;
ALTER TABLE events ADD COLUMN imported TEXT;
CREATE INDEX IF NOT EXISTS sessions_imported ON sessions (site_id, imported);
CREATE INDEX IF NOT EXISTS events_imported ON events (site_id, imported);
`
