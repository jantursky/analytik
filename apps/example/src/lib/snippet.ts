import type { PrivacyMode } from 'analytik'

export interface SnippetOptions {
  host: string
  siteId: string
  mode: PrivacyMode
  requireInteraction: boolean
  allowLocalhost: boolean
  autoOutbound: boolean
}

export const DEFAULT_OPTIONS: SnippetOptions = {
  host: 'https://analytics.example.com',
  siteId: 'my-site',
  mode: 'strict',
  requireInteraction: true,
  allowLocalhost: false,
  autoOutbound: true,
}

export const escapeAttr = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** `https://host/` -> `https://host`; null unless it is an http(s) origin. */
export const normalizeHost = (input: string): string | null => {
  try {
    const url = new URL(input.trim())
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null
  } catch {
    return null
  }
}

const tag = (attributes: [string, string][]): string => {
  const parts = attributes.map(([name, value]) => (value === '' ? name : `${name}="${escapeAttr(value)}"`))
  return `<script ${parts.join(' ')}></script>`
}

/** The tracker origin for the given options, falling back to the placeholder host while the input is invalid. */
export const hostOf = (options: SnippetOptions): string => normalizeHost(options.host) ?? DEFAULT_OPTIONS.host

export const siteOf = (options: SnippetOptions): string => options.siteId.trim() || DEFAULT_OPTIONS.siteId

/** Script tag attributes for the given options, in order. Attributes that match the defaults are left out. */
export const scriptAttributes = (options: SnippetOptions): [string, string][] => {
  const attributes: [string, string][] = [
    ['defer', ''],
    ['src', `${hostOf(options)}/js/analytik.js`],
    ['data-site', siteOf(options)],
    ['data-mode', options.mode],
  ]
  if (!options.requireInteraction) attributes.push(['data-require-interaction', 'false'])
  if (options.allowLocalhost) attributes.push(['data-allow-localhost', 'true'])
  if (!options.autoOutbound) attributes.push(['data-auto-outbound', 'false'])
  return attributes
}

export const scriptTag = (options: SnippetOptions): string => tag(scriptAttributes(options))

export const reactSnippet = (options: SnippetOptions): string => {
  const site = JSON.stringify(siteOf(options))
  const api = JSON.stringify(`${hostOf(options)}/api`)
  return `import { AnalytikProvider, useTrackPageviews } from 'analytik/react'

function Pageviews() {
  useTrackPageviews()
  return null
}

export function Root({ children }: { children: React.ReactNode }) {
  return (
    <AnalytikProvider site={${site}} api={${api}} mode="${options.mode}">
      <Pageviews />
      {children}
    </AnalytikProvider>
  )
}
`
}

export const serverSnippet = (options: SnippetOptions): string => `import { createAnalytik } from 'analytik/server'
import { d1Storage } from 'analytik/storage/d1'

export default {
  fetch(request: Request, env: Env) {
    return createAnalytik({
      storage: d1Storage(env.DB),
      admin: { password: env.ADMIN_PASSWORD, secret: env.SESSION_SECRET },
      privacy: { mode: '${options.mode}' },
    }).app.fetch(request, env)
  },
}
`
