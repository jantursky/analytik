/*! analytik | MIT | <script defer src="https://YOUR-HOST/analytik.js" data-site="SITE_ID"></script> */
import type { PrivacyMode } from '../shared/types'
import { createEngine } from './engine'
import { replay, toGlobal } from './global'
import type { AnalytikGlobal } from './types'

type Stub = Partial<AnalytikGlobal> & { q?: ArrayLike<unknown>[] }

const w = window as Window & { analytik?: Stub }
// currentScript is null when the script is loaded as a module or injected late, so fall back to a lookup.
const script = document.currentScript ?? document.querySelector('script[data-site],script[src*="analytik"]')

if (script && !w.analytik?.track) {
  const attr = (name: string): string | null => script.getAttribute('data-' + name)
  /** Presence turns a flag on (`data-debug`), `"false"` turns it off. */
  const flag = (name: string, fallback: boolean): boolean => {
    const value = attr(name)
    return value == null ? fallback : value !== 'false'
  }
  const src = script.getAttribute('src')

  const engine = createEngine({
    site: attr('site') ?? '',
    api: attr('api') ?? (src ? new URL(src, location.href).origin : '') + '/api',
    mode: (attr('mode') ?? undefined) as PrivacyMode | undefined,
    allowLocalhost: flag('allow-localhost', false),
    domain: attr('domain') ?? undefined,
    requireInteraction: flag('require-interaction', true),
    keepQuery: attr('keep-query')?.split(/[\s,]+/),
    debug: flag('debug', false),
    autoOutbound: flag('auto-outbound', true),
    autoTrackAttrs: flag('auto-track-attrs', true),
  })
  const queue = w.analytik?.q ?? []
  const analytik = toGlobal(engine)
  w.analytik = analytik
  replay(analytik, queue)
}
