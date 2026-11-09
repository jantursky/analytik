/**
 * Two indexes for lookups that scanned their table: the cleanup of stale rate-limit counters, and one site's events of
 * one type in a time range (goals, outbound links, revenue). Safe to run twice; no data changes.
 */
export const hotIndexes = (): string => `
CREATE INDEX IF NOT EXISTS rate_limits_window ON rate_limits (window_start);
CREATE INDEX IF NOT EXISTS events_site_type_ts ON events (site_id, type, ts);
`
