/** Site id of the seeded demo site; the shop reports to it and the dashboard reads it. */
export const SITE_ID = 'demo'
export const API_BASE = '/api'

/**
 * A read-only share link of the demo site, so the shared dashboard can be tried: open the dashboard with
 * `?site=demo&share=<this token>`. The demo is public and read-only anyway, so the token is no secret.
 */
export const DEMO_SHARE_TOKEN = 'demo-share-link-0123456789abcdefghijklmnopqrstu'
