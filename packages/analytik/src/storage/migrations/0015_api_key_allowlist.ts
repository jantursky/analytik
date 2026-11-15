/**
 * An optional list of allowed client addresses and ranges per API key, a JSON list of normalised entries. Null means
 * any address, so existing keys stay as they were.
 */
export const apiKeyAllowlist = (): string => `
ALTER TABLE api_keys ADD COLUMN ip_allowlist TEXT;
`
