/** Column types that differ between the dialects. */
export interface ColumnTypes {
  /** Unix milliseconds, durations and money in minor units. */
  big: string
  /** Coordinates. */
  real: string
}

/**
 * The first schema. A string rather than a .sql file, so it ships inside the bundle and runs on Workers.
 * All times are unix milliseconds; JSON columns hold text.
 */
export const init = ({ big, real }: ColumnTypes): string => `
CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  currency TEXT NOT NULL DEFAULT 'USD',
  privacy_mode TEXT NOT NULL DEFAULT 'strict',
  api_key_hash TEXT NOT NULL,
  webhook_secrets TEXT NOT NULL DEFAULT '{}',
  retention_days INTEGER,
  allow_localhost INTEGER NOT NULL DEFAULT 0,
  paused INTEGER NOT NULL DEFAULT 0,
  ignored_ips TEXT NOT NULL DEFAULT '[]',
  share_token TEXT,
  created_at ${big} NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS sites_api_key ON sites (api_key_hash);

-- In strict mode an id lives for one month (it is a salted hash); in persistent mode it comes from a cookie.
CREATE TABLE IF NOT EXISTS visitors (
  site_id TEXT NOT NULL,
  id TEXT NOT NULL,
  first_seen ${big} NOT NULL,
  user_id TEXT,
  name TEXT,
  email TEXT,
  PRIMARY KEY (site_id, id)
);
CREATE INDEX IF NOT EXISTS visitors_email ON visitors (site_id, email);

-- One visit, closed after 30 idle minutes, with where it came from and what it ran on.
CREATE TABLE IF NOT EXISTS sessions (
  site_id TEXT NOT NULL,
  id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  started_at ${big} NOT NULL,
  last_seen_at ${big} NOT NULL,
  duration ${big} NOT NULL DEFAULT 0,
  pageviews INTEGER NOT NULL DEFAULT 0,
  goals INTEGER NOT NULL DEFAULT 0,
  hostname TEXT,
  entry_page TEXT,
  exit_page TEXT,
  referrer TEXT,
  referrer_domain TEXT,
  source TEXT NOT NULL,
  channel TEXT NOT NULL,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT,
  ref TEXT,
  country TEXT,
  region TEXT,
  city TEXT,
  browser TEXT,
  os TEXT,
  device TEXT,
  lat ${real},
  lon ${real},
  PRIMARY KEY (site_id, id)
);
CREATE INDEX IF NOT EXISTS sessions_site_time ON sessions (site_id, started_at);
CREATE INDEX IF NOT EXISTS sessions_visitor ON sessions (site_id, visitor_id, last_seen_at);
CREATE INDEX IF NOT EXISTS sessions_site_seen ON sessions (site_id, last_seen_at, visitor_id);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  ts ${big} NOT NULL,
  type TEXT NOT NULL,
  name TEXT,
  path TEXT,
  props TEXT
);
CREATE INDEX IF NOT EXISTS events_site_time ON events (site_id, ts);
CREATE INDEX IF NOT EXISTS events_session ON events (site_id, session_id);

-- Amounts in minor units; a refund is a row with a negative amount.
CREATE TABLE IF NOT EXISTS payments (
  id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  ts ${big} NOT NULL,
  amount ${big} NOT NULL,
  kind TEXT NOT NULL DEFAULT 'payment',
  currency TEXT NOT NULL,
  visitor_id TEXT,
  session_id TEXT,
  customer_id TEXT,
  email TEXT,
  name TEXT,
  renewal INTEGER NOT NULL DEFAULT 0,
  matched_by TEXT,
  subscription_id TEXT,
  order_id TEXT,
  PRIMARY KEY (site_id, id)
);
CREATE INDEX IF NOT EXISTS payments_site_time ON payments (site_id, ts);
CREATE INDEX IF NOT EXISTS payments_customer ON payments (site_id, customer_id);
CREATE INDEX IF NOT EXISTS payments_visitor ON payments (site_id, visitor_id, ts);
CREATE INDEX IF NOT EXISTS payments_order ON payments (site_id, order_id);

-- Ids a visitor's browser brought back from checkout, waiting for (or pointing at) the matching payment.
CREATE TABLE IF NOT EXISTS payment_claims (
  site_id TEXT NOT NULL,
  payment_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  ts ${big} NOT NULL,
  PRIMARY KEY (site_id, payment_id)
);

CREATE TABLE IF NOT EXISTS funnels (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  name TEXT NOT NULL,
  steps TEXT NOT NULL,
  created_at ${big} NOT NULL
);
CREATE INDEX IF NOT EXISTS funnels_site ON funnels (site_id);

-- The current month's secret for strict-mode visitor hashes; older rows are deleted.
CREATE TABLE IF NOT EXISTS salts (
  month TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at ${big} NOT NULL
);

-- Dashboard settings shared by every admin (overview layout, live refresh, chart choices), as JSON text.
CREATE TABLE IF NOT EXISTS preferences (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at ${big} NOT NULL
);

-- Fixed-window counters keyed by a hash, for login attempts and the attribution endpoint.
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_start ${big} NOT NULL,
  count INTEGER NOT NULL
);
`
