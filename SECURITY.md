# Security policy

## Supported versions

Only the latest release of `analytik` gets fixes.

## Reporting a vulnerability

Please don't open a public issue. Use GitHub's [private vulnerability reporting](https://github.com/jantursky/analytik/security/advisories/new), or email jan.tursky@gmail.com with a description and, if you can, a minimal reproduction.

You'll get an answer within a week. Once a fix is released, the advisory is published with credit, unless you'd rather stay anonymous.

## Things to know

- IP addresses are read from the request to compute the visitor hash and the country, and then dropped. They are never written to storage. Location comes from edge headers when the platform sends them. Coordinates are rounded to two decimal places.
- Visitor IDs are an HMAC of the site, the IP address and the user agent, keyed with a random salt. The salt is created per UTC month, stored in the `salts` table and deleted when the month ends. Once it's gone, the visitor IDs from that month can't be linked to anyone again.
- Ingestion only accepts events from allowed origins. By default that is the registered site domain and its subdomains. Localhost is allowed only when you turn it on. Other origins get a 403.
- Admin routes need a session cookie from the login route or an admin bearer token. Set a long random `SESSION_SECRET` and a strong `ADMIN_PASSWORD`, and don't expose the admin routes without them.
- Each site's API key is stored only as a hash. Rotating a key replaces the stored hash, so the old key stops working.
- Webhooks are verified with the per-site secret before anything is stored: Stripe signs with HMAC-SHA256, Dodo uses Standard Webhooks and Lemon Squeezy sends `X-Signature`. A request that fails verification is rejected and not recorded.
- Rate limits are kept in the storage layer as a fixed window per hashed client. The attribution endpoint uses it, and failed admin logins are counted there too.
- Request sizes are capped. A tracker event may be at most 8 KB, and larger bodies get a 413.
- Each site has a retention period (`retention_days`), and the admin API can delete everything older than a given date in one request. Set the period before you start collecting.
- Admins can export all of a site's data as JSON or CSV, for backup. Treat an export file like the database itself.
