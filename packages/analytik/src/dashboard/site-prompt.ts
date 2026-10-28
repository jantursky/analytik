import type { PrivacyMode } from '../shared/types'

// The prompt that asks a coding assistant to add the tracker to a site, in the right file for its framework. It is
// loaded on demand, because the framework guides are long and only wanted when someone copies the prompt.

export interface SnippetOptions {
  host: string
  siteId: string
  mode: PrivacyMode
  requireInteraction: boolean
  allowLocalhost: boolean
  autoOutbound: boolean
}

const PLACEHOLDER_HOST = 'https://analytics.example.com'

const escapeAttr = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** `https://host/` -> `https://host`; null unless it is an http(s) origin. */
const normalizeHost = (input: string): string | null => {
  try {
    const url = new URL(input.trim())
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null
  } catch {
    return null
  }
}

const hostOf = (options: SnippetOptions): string => normalizeHost(options.host) ?? PLACEHOLDER_HOST

const siteOf = (options: SnippetOptions): string => options.siteId.trim() || 'my-site'

/** Script tag attributes for the given options, in order. Attributes that match the defaults are left out. */
const scriptAttributes = (options: SnippetOptions): [string, string][] => {
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

const scriptTag = (options: SnippetOptions): string => {
  const parts = scriptAttributes(options).map(([name, value]) =>
    value === '' ? name : `${name}="${escapeAttr(value)}"`,
  )
  return `<script ${parts.join(' ')}></script>`
}

export const SITE_TARGETS = [
  { id: 'html', label: 'Plain HTML' },
  { id: 'react-vite', label: 'React (Vite)' },
  { id: 'nextjs', label: 'Next.js (App Router)' },
  { id: 'remix', label: 'Remix / React Router' },
  { id: 'vue', label: 'Vue' },
  { id: 'nuxt', label: 'Nuxt' },
  { id: 'astro', label: 'Astro' },
  { id: 'sveltekit', label: 'Svelte / SvelteKit' },
  { id: 'angular', label: 'Angular' },
  { id: 'solidstart', label: 'SolidStart' },
  { id: 'qwik', label: 'Qwik' },
  { id: 'gatsby', label: 'Gatsby' },
  { id: 'docusaurus', label: 'Docusaurus' },
  { id: 'hugo', label: 'Hugo' },
  { id: 'jekyll', label: 'Jekyll' },
  { id: 'eleventy', label: 'Eleventy' },
  { id: 'wordpress', label: 'WordPress' },
  { id: 'shopify', label: 'Shopify' },
  { id: 'webflow', label: 'Webflow' },
  { id: 'framer', label: 'Framer' },
  { id: 'ghost', label: 'Ghost' },
  { id: 'laravel', label: 'Laravel (Blade)' },
  { id: 'rails', label: 'Ruby on Rails' },
  { id: 'django', label: 'Django' },
  { id: 'flask', label: 'Flask' },
  { id: 'gtm', label: 'Google Tag Manager' },
] as const

export type SiteTarget = (typeof SITE_TARGETS)[number]['id']

interface CodeFile {
  path: string
  lang: string
  code: string
}

const fence = ({ path, lang, code }: CodeFile): string => `\`${path}\`:\n\n\`\`\`${lang}\n${code.trimEnd()}\n\`\`\``

const numbered = (items: readonly string[]): string => items.map((item, index) => `${index + 1}. ${item}`).join('\n')

const bullets = (items: readonly string[]): string => items.map((item) => `- ${item}`).join('\n')

const labelOf = <T extends { id: string; label: string }>(targets: readonly T[], id: T['id']): string =>
  targets.find((target) => target.id === id)?.label ?? id

/* Site */

type Render = (options: SnippetOptions) => string

interface SiteGuide {
  where: string
  file: string
  lang: string
  code: Render
  notes?: string[]
}

const htmlTag: Render = (options) => scriptTag(options)

/** The tag as JSX: the same attributes plus framework-specific extras. */
const jsxTag = (options: SnippetOptions, extra: [string, string][] = []): string => {
  const parts = [...scriptAttributes(options), ...extra].map(([name, value]) =>
    value === '' ? name : `${name}="${escapeAttr(value)}"`,
  )
  return `<script ${parts.join(' ')}></script>`
}

/** The attributes as a JS object literal, for config files (Nuxt, Docusaurus). */
const objectTag = (options: SnippetOptions, indent: string): string => {
  const entries = scriptAttributes(options).map(([name, value]) => {
    const key = /^[a-z]+$/.test(name) ? name : `'${name}'`
    return `${indent}  ${key}: ${value === '' ? 'true' : `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`},`
  })
  return `{\n${entries.join('\n')}\n${indent}}`
}

/** The tag inside a template conditional, so it renders in production only. */
const inHead =
  (open: string, close: string): Render =>
  (options) =>
    `${open}\n${scriptTag(options)}\n${close}`

const SPA_NOTE = 'Client-side route changes are tracked automatically: the tracker listens to the History API.'

const SITE_GUIDES: Record<SiteTarget, SiteGuide> = {
  html: {
    where: 'Paste the tag into the `<head>` of every page, or once into the shared header include if the site has one.',
    file: 'index.html (every page)',
    lang: 'html',
    code: htmlTag,
  },
  'react-vite': {
    where:
      'Use the npm package so events are typed: wrap the app in `AnalytikProvider` in `src/main.tsx`. The client records the first pageview and every route change itself.',
    file: 'src/main.tsx',
    lang: 'tsx',
    code: (options) => `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AnalytikProvider } from 'analytik/react'

import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AnalytikProvider site="${escapeAttr(siteOf(options))}" api="${hostOf(options)}/api" mode="${options.mode}">
      <App />
    </AnalytikProvider>
  </StrictMode>,
)`,
    notes: [
      'Install with `npm install analytik` (React 19).',
      "Send events from components with `const analytik = useAnalytik()` from 'analytik/react', then `analytik.track(...)`.",
      'Do not also add the script tag, or pageviews count twice.',
    ],
  },
  nextjs: {
    where:
      'Add the tag with `next/script` in the root layout `app/layout.tsx`, inside `<body>`, with `strategy="afterInteractive"`. Use `next/script`\'s own loading instead of `defer`.',
    file: 'app/layout.tsx',
    lang: 'tsx',
    code: (options) => {
      const attributes = scriptAttributes(options)
        .filter(([name]) => name !== 'defer')
        .map(([name, value]) => `          ${name}="${escapeAttr(value)}"`)
      return `import Script from 'next/script'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Script
${attributes.join('\n')}
          strategy="afterInteractive"
        />
      </body>
    </html>
  )
}`
    },
    notes: [SPA_NOTE, 'Keep the existing layout content; only add the import and the `<Script>` element.'],
  },
  remix: {
    where: 'Add the tag to the `<head>` of the `Layout` export in `app/root.tsx`, after `<Links />`.',
    file: 'app/root.tsx',
    lang: 'tsx',
    code: (options) => `export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <Meta />
        <Links />
        ${jsxTag(options)}
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}`,
    notes: [SPA_NOTE],
  },
  vue: {
    where: 'Paste the tag into the `<head>` of `index.html` at the project root (Vite).',
    file: 'index.html',
    lang: 'html',
    code: htmlTag,
    notes: [`${SPA_NOTE} That covers Vue Router.`],
  },
  nuxt: {
    where: 'Register the script in `nuxt.config.ts` under `app.head.script` so it is in the head of every page.',
    file: 'nuxt.config.ts',
    lang: 'ts',
    code: (options) => `export default defineNuxtConfig({
  app: {
    head: {
      script: [
        ${objectTag(options, '        ')},
      ],
    },
  },
})`,
    notes: [SPA_NOTE, 'Merge into the existing config instead of replacing it.'],
  },
  astro: {
    where:
      'Add the tag to the `<head>` of the base layout (often `src/layouts/Layout.astro`) with `is:inline`, so Astro leaves it untouched instead of bundling it.',
    file: 'src/layouts/Layout.astro',
    lang: 'astro',
    code: (options) => jsxTag(options, [['is:inline', '']]),
    notes: ['View transitions (`<ClientRouter />`) navigate with the History API, which the tracker follows.'],
  },
  sveltekit: {
    where:
      'SvelteKit: paste the tag into `src/app.html`, inside `<head>` before `%sveltekit.head%`. Svelte with plain Vite: `index.html`.',
    file: 'src/app.html',
    lang: 'html',
    code: htmlTag,
    notes: [SPA_NOTE],
  },
  angular: {
    where: 'Paste the tag into the `<head>` of `src/index.html`.',
    file: 'src/index.html',
    lang: 'html',
    code: htmlTag,
    notes: [`${SPA_NOTE} That covers the Angular router.`],
  },
  solidstart: {
    where: 'Add the tag to the `<head>` of the document in `src/entry-server.tsx`.',
    file: 'src/entry-server.tsx',
    lang: 'tsx',
    code: (options) => `export default createHandler(() => (
  <StartServer
    document={({ assets, children, scripts }) => (
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          ${jsxTag(options)}
          {assets}
        </head>
        <body>
          <div id="app">{children}</div>
          {scripts}
        </body>
      </html>
    )}
  />
))`,
    notes: [SPA_NOTE],
  },
  qwik: {
    where: 'Add the tag to the `<head>` in `src/root.tsx` (Qwik City).',
    file: 'src/root.tsx',
    lang: 'tsx',
    code: (options) => `<head>
  <meta charset="utf-8" />
  <RouterHead />
  ${jsxTag(options)}
</head>`,
    notes: [SPA_NOTE],
  },
  gatsby: {
    where: 'Add the tag in `gatsby-ssr.js` (or `.tsx`) with `onRenderBody` and `setHeadComponents`.',
    file: 'gatsby-ssr.js',
    lang: 'jsx',
    code: (options) => `export const onRenderBody = ({ setHeadComponents }) => {
  setHeadComponents([
    ${jsxTag(options, [['key', 'analytik']])},
  ])
}`,
    notes: [SPA_NOTE],
  },
  docusaurus: {
    where: 'Register the script in `docusaurus.config.js` (or `.ts`) under the top-level `scripts` array.',
    file: 'docusaurus.config.js',
    lang: 'js',
    code: (options) => `export default {
  // ...the existing config
  scripts: [
    ${objectTag(options, '    ')},
  ],
}`,
    notes: [SPA_NOTE],
  },
  hugo: {
    where:
      "Add the tag to the site's head partial. If it comes from a theme, copy the theme's `layouts/partials/head.html` into the site's own `layouts/partials/` and edit the copy.",
    file: 'layouts/partials/head.html',
    lang: 'go-html-template',
    code: inHead('{{ if hugo.IsProduction }}', '{{ end }}'),
  },
  jekyll: {
    where:
      "Add the tag to `_includes/head.html`. With a gem theme (such as minima), copy the theme's `_includes/head.html` into the site first.",
    file: '_includes/head.html',
    lang: 'liquid',
    code: inHead('{% if jekyll.environment == "production" %}', '{% endif %}'),
    notes: ['Production builds run with `JEKYLL_ENV=production jekyll build`.'],
  },
  eleventy: {
    where:
      'Add the tag to the `<head>` of the base layout (often `_includes/base.njk` or `_includes/layouts/base.njk`).',
    file: '_includes/base.njk',
    lang: 'html',
    code: htmlTag,
  },
  wordpress: {
    where:
      'Without code: install the WPCode plugin and paste the tag into Code Snippets > Header & Footer > Header. With code: add a `wp_head` action to the child theme (never the parent theme, updates overwrite it).',
    file: 'wp-content/themes/<child-theme>/functions.php',
    lang: 'php',
    code: (options) => `add_action('wp_head', function () {
    ?>
    ${scriptTag(options)}
    <?php
});`,
    notes: ['Caching plugins may combine or delay scripts; exclude `analytik.js` from JavaScript optimisation.'],
  },
  shopify: {
    where: 'In Online Store > Themes > Edit code, open `layout/theme.liquid` and paste the tag just before `</head>`.',
    file: 'layout/theme.liquid',
    lang: 'liquid',
    code: htmlTag,
    notes: [
      'Checkout pages are not part of the theme. Record orders server side instead: an `orders/paid` webhook that calls `POST /api/v1/payments` with the site API key.',
    ],
  },
  webflow: {
    where:
      'In Site settings > Custom code, paste the tag into Head code, save and publish. Custom code needs a paid site plan.',
    file: 'Site settings > Custom code > Head code',
    lang: 'html',
    code: htmlTag,
  },
  framer: {
    where: 'In Site Settings > General > Custom Code, paste the tag into "End of <head> tag" and publish.',
    file: 'Site Settings > Custom Code > End of <head>',
    lang: 'html',
    code: htmlTag,
    notes: [SPA_NOTE],
  },
  ghost: {
    where: 'In Settings > Code injection, paste the tag into Site header and save.',
    file: 'Settings > Code injection > Site header',
    lang: 'html',
    code: htmlTag,
  },
  laravel: {
    where: 'Add the tag to the `<head>` of the main Blade layout, inside `@production` so local runs stay out.',
    file: 'resources/views/layouts/app.blade.php',
    lang: 'blade',
    code: inHead('@production', '@endproduction'),
  },
  rails: {
    where: 'Add the tag to the `<head>` of `app/views/layouts/application.html.erb`, for production only.',
    file: 'app/views/layouts/application.html.erb',
    lang: 'erb',
    code: inHead('<% if Rails.env.production? %>', '<% end %>'),
    notes: ['Turbo Drive navigations use the History API, which the tracker follows; keep the tag in `<head>`.'],
  },
  django: {
    where: 'Add the tag to the `<head>` of the base template that every page extends (often `templates/base.html`).',
    file: 'templates/base.html',
    lang: 'django',
    code: inHead('{% if not debug %}', '{% endif %}'),
    notes: ['`debug` is only set in templates when the request IP is in `INTERNAL_IPS`; otherwise the tag renders.'],
  },
  flask: {
    where: 'Add the tag to the `<head>` of the base Jinja template (often `templates/base.html`).',
    file: 'templates/base.html',
    lang: 'jinja',
    code: inHead('{% if not config.DEBUG %}', '{% endif %}'),
  },
  gtm: {
    where:
      'In Google Tag Manager, create a tag of type Custom HTML, paste the tag, set the trigger to All Pages (or Initialization - All Pages), then submit and publish the container.',
    file: 'GTM > Tags > New > Custom HTML',
    lang: 'html',
    code: htmlTag,
    notes: [
      'Leave "Support document.write" off. The tracker finds its tag by `data-site` when GTM injects it.',
      `${SPA_NOTE} Do not add a History Change trigger, or pageviews count twice.`,
    ],
  },
}

const PRIVACY_RULES: Record<PrivacyMode, string[]> = {
  strict: [
    'Strict mode stores nothing on the device: no cookie, no localStorage, no sessionStorage. The IP is used for a salted hash and never stored.',
    'By design no cookie banner is needed for Analytik in this mode, so do not put it behind a consent manager and do not list a cookie for it (not legal advice; the site owner decides).',
    'Do not call `analytik.identify()`: strict mode ignores it. Identify people only with their consent, on a site switched to enriched or persistent mode.',
  ],
  enriched: [
    'Enriched mode adds a per-tab id in sessionStorage, but only after `analytik.consent()`. Before that it behaves like strict mode.',
    "Call `analytik.consent()` from the site's consent banner when the visitor accepts analytics, and `analytik.withdrawConsent()` when they revoke it.",
    '`analytik.identify({ userId, email, name })` works only after consent. Never send it without consent.',
  ],
  persistent: [
    'Persistent mode sets first-party cookies (`analytik_vid`, 1 year; `analytik_sid`, 30 minutes). Treat it as needing consent in the EU.',
    "Load the tag only after the visitor accepts analytics in the site's consent banner, and call `analytik.withdrawConsent()` when they revoke it.",
    '`analytik.identify({ userId, email, name })` is allowed once the visitor consented.',
  ],
}

const eventsSection = (target: SiteTarget, host: string): string => {
  const call = target === 'react-vite' ? 'analytik' : 'window.analytik?'
  return `Pick the events that matter for this site (sign-ups, checkouts) and add them:

\`\`\`html
<!-- Declarative: a click on this element sends the goal "signup" with the prop plan=pro. -->
<button data-analytik-event="signup" data-analytik-plan="pro">Start free trial</button>
\`\`\`

\`\`\`js
${call}.track('signup', { plan: 'pro' })
// Revenue in major units; orderId de-duplicates repeats (for example a reloaded thank-you page).
${call}.revenue('purchase', 49, { currency: 'EUR', orderId: 'order_1042' })
\`\`\`

For payments confirmed on the server (Stripe, Dodo, Lemon Squeezy or your own backend), prefer \`POST ${host}/api/v1/payments\` with the site API key, so revenue is recorded even when the visitor closes the tab.${target === 'react-vite' ? '' : ' To call `analytik` before the script has loaded, add the queue stub first: `window.analytik = window.analytik || function () { (window.analytik.q = window.analytik.q || []).push(arguments) }`.'}`
}

/** A prompt that asks a coding assistant to add the tracker to a site built with the chosen framework or platform. */
export const sitePrompt = (target: SiteTarget, options: SnippetOptions): string => {
  const guide = SITE_GUIDES[target]
  const host = hostOf(options)
  const site = siteOf(options)
  const label = labelOf(SITE_TARGETS, target)
  return `# Add Analytik tracking to your ${label} site

## Goal

Add the Analytik tracker (privacy-first, self-hosted web analytics) to this ${label} site so every page sends pageviews to ${host}. The analytics server is already running; only the website changes. Site id: \`${site}\`, privacy mode: \`${options.mode}\`. If the site id looks like a placeholder, ask me for the real one.

## The snippet

\`\`\`html
${scriptTag(options)}
\`\`\`

## Where to put it in ${label}

${guide.where}

${fence({ path: guide.file, lang: guide.lang, code: guide.code(options) })}${guide.notes ? `\n\n${bullets(guide.notes)}` : ''}

Add it once, site wide. Do not self-host or bundle the script, and do not add a second analytics snippet for the same site.

## Privacy

${bullets(PRIVACY_RULES[options.mode])}

## Goals and revenue

${eventsSection(target, host)}

## Verify

${numbered([
  `Open the site in a normal browser window (the tracker ignores automated browsers) with ad blockers off. The first pageview is sent after the first interaction or 3 seconds of visibility${options.requireInteraction ? '' : ' (here: immediately, interaction is not required)'}.`,
  `In DevTools > Network, filter for \`event\`: a \`POST ${host}/api/event\` request returns **202**. 403 means the page's host is not the site's domain (on localhost add \`data-allow-localhost\` and enable allowLocalhost for the site); 404 means the site id is wrong.`,
  'Open the Analytik dashboard: the visit shows up in Realtime within a few seconds.',
  'If you added goals or revenue, trigger one and check that it appears under Events or Revenue.',
])}
`
}
