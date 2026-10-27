import { useId, useState } from 'react'
import type { PrivacyMode } from 'analytik'

import { CodeBlock, Collapsible, CopyButton } from '../components'
import { SERVER_ICONS, SITE_ICONS } from '../lib/icons'
import {
  SERVER_TARGETS,
  SITE_TARGETS,
  serverPrompt,
  sitePrompt,
  type ServerTarget,
  type SiteTarget,
} from '../lib/prompts'
import {
  DEFAULT_OPTIONS,
  hostOf,
  normalizeHost,
  reactSnippet,
  scriptTag,
  serverSnippet,
  type SnippetOptions,
} from '../lib/snippet'
import { PromptPanel } from '../PromptPanel'

type Target = 'script' | 'react' | 'server'

const TARGETS: { id: Target; label: string }[] = [
  { id: 'script', label: 'Script tag' },
  { id: 'react', label: 'React' },
  { id: 'server', label: 'Server' },
]

const MODES: PrivacyMode[] = ['strict', 'enriched', 'persistent']

const dashboardSnippet = (options: SnippetOptions) => `import { Dashboard } from 'analytik/dashboard'
import 'analytik/dashboard/styles.css'

export const Admin = () => <Dashboard api="${hostOf(options)}/api" />`

function Step({
  n,
  title,
  text,
  file,
  code,
  label,
}: {
  n: number
  title: string
  text: string
  file: string
  code: string
  label: string
}) {
  return (
    <li className="step card">
      <div className="step__head">
        <span className="step__number" aria-hidden="true">
          {n}
        </span>
        <h3>{title}</h3>
      </div>
      <p className="muted">{text}</p>
      <div className="step__code">
        <div className="code__bar">
          <span>{file}</span>
          <CopyButton text={code} label={`Copy ${label}`} />
        </div>
        <pre tabIndex={0}>
          <code>{code}</code>
        </pre>
      </div>
    </li>
  )
}

// Install in three steps, a full snippet generator behind "More options", and copy-ready prompts for coding
// assistants. All of them read the same options, so a host typed once shows up everywhere.
export function InstallExample() {
  const [options, setOptions] = useState<SnippetOptions>(DEFAULT_OPTIONS)
  const [target, setTarget] = useState<Target>('script')
  const [server, setServer] = useState<ServerTarget>('cloudflare-d1')
  const [site, setSite] = useState<SiteTarget>('html')
  const ids = { host: useId(), site: useId(), mode: useId() }
  const set = <K extends keyof SnippetOptions>(key: K, value: SnippetOptions[K]) => {
    setOptions((previous) => ({ ...previous, [key]: value }))
  }
  const hostValid = normalizeHost(options.host) !== null

  const code =
    target === 'script' ? scriptTag(options) : target === 'react' ? reactSnippet(options) : serverSnippet(options)

  return (
    <div className="stack stack--loose">
      <ol className="steps-grid">
        <Step
          n={1}
          title="Deploy the server"
          text="Print a starter server for Workers, Vercel, Bun or Node, then deploy it like any small app."
          file="Terminal"
          code="npx analytik init --target worker"
          label="the init command"
        />
        <Step
          n={2}
          title="Add the snippet to your site"
          text="Paste it into the <head> of every page. It sets no cookies."
          file="HTML"
          code={scriptTag(options)}
          label="the script tag"
        />
        <Step
          n={3}
          title="Open the dashboard"
          text="Embed it in any React app and sign in with your admin password."
          file="Admin.tsx"
          code={dashboardSnippet(options)}
          label="the dashboard component"
        />
      </ol>

      <Collapsible title="More options" hint="Your host, site id, privacy mode and the React and server snippets">
        <div className="split">
          <div className="stack">
            <label className="field" htmlFor={ids.host}>
              Your Analytik host
              <input
                id={ids.host}
                className="input"
                value={options.host}
                aria-invalid={!hostValid}
                onChange={(event) => {
                  set('host', event.target.value)
                }}
              />
            </label>
            {!hostValid && <p className="warning">Enter a full URL such as https://analytics.example.com.</p>}
            <label className="field" htmlFor={ids.site}>
              Site id
              <input
                id={ids.site}
                className="input"
                value={options.siteId}
                onChange={(event) => {
                  set('siteId', event.target.value)
                }}
              />
            </label>
            <label className="field" htmlFor={ids.mode}>
              Privacy mode
              <select
                id={ids.mode}
                className="input"
                value={options.mode}
                onChange={(event) => {
                  set('mode', event.target.value as PrivacyMode)
                }}
              >
                {MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </select>
            </label>
            <label className="row">
              <input
                type="checkbox"
                checked={options.requireInteraction}
                onChange={(event) => {
                  set('requireInteraction', event.target.checked)
                }}
              />
              Wait for interaction or 3 s before the first pageview
            </label>
            <label className="row">
              <input
                type="checkbox"
                checked={options.allowLocalhost}
                onChange={(event) => {
                  set('allowLocalhost', event.target.checked)
                }}
              />
              Track localhost (for testing)
            </label>
            <label className="row">
              <input
                type="checkbox"
                checked={options.autoOutbound}
                onChange={(event) => {
                  set('autoOutbound', event.target.checked)
                }}
              />
              Track outbound link clicks
            </label>
          </div>

          <div className="stack">
            <div className="tabs" role="tablist" aria-label="Snippet target">
              {TARGETS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={target === id}
                  onClick={() => {
                    setTarget(id)
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <CodeBlock label={TARGETS.find((entry) => entry.id === target)?.label ?? ''} code={code} />
          </div>
        </div>
      </Collapsible>

      <PromptPanel
        title="Server setup prompt"
        description="Let your coding assistant deploy Analytik. Pick where it runs; the prompt uses the host and mode from More options."
        options={SERVER_TARGETS}
        icons={SERVER_ICONS}
        value={server}
        onChange={setServer}
        prompt={serverPrompt(server, options)}
      />
      <PromptPanel
        title="Site integration prompt"
        description="Let your coding assistant add the tracker to your site, in the right file for your framework."
        options={SITE_TARGETS}
        icons={SITE_ICONS}
        value={site}
        onChange={setSite}
        prompt={sitePrompt(site, options)}
      />
    </div>
  )
}

export default InstallExample
