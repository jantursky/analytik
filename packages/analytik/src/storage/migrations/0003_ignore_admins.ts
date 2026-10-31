/** Per-site switch that drops events from browsers signed in as admin. Off for every existing site. */
export const ignoreAdmins = (): string => `
ALTER TABLE sites ADD COLUMN ignore_admins INTEGER NOT NULL DEFAULT 0;
`
