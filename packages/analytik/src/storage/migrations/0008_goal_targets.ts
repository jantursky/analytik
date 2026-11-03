/** Targets for goals ("1,000 signups a month") as JSON text on the site, at most 20. Empty for every existing site. */
export const goalTargets = (): string => `
ALTER TABLE sites ADD COLUMN targets TEXT NOT NULL DEFAULT '[]';
`
