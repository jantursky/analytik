/**
 * One goal's events in a time range (the property report and the goal filters) read only that goal's rows, not every
 * goal of the site in the range. Safe to run twice; no data changes.
 */
export const eventNameIndex = (): string => `
CREATE INDEX IF NOT EXISTS events_site_type_name_ts ON events (site_id, type, name, ts);
`
