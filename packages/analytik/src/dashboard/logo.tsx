import { useEffect, useState } from 'react'

type Logos = Record<string, string>

/** Report values drawn with another value's mark. */
const ALIASES: Record<string, string> = {
  'Mobile Safari': 'Safari',
  'Chrome WebView': 'Chrome',
  'Chrome OS': 'Chrome',
  'Mac OS': 'Apple',
  iOS: 'Apple',
  iPadOS: 'Apple',
}

let logos: Logos | undefined
let loading: Promise<Logos> | undefined

function useLogos(): Logos | undefined {
  const [loaded, setLoaded] = useState(logos)
  useEffect(() => {
    if (loaded) return
    loading ??= import('./logos').then((m) => (logos = m.LOGOS))
    let active = true
    void loading.then((l) => active && setLoaded(l))
    return () => {
      active = false
    }
  }, [loaded])
  return loaded
}

/** Whether `name` has a mark, e.g. to decide whether to reserve room for one. */
export const hasLogo = (name: string): boolean => KNOWN.has(ALIASES[name] ?? name)

// The keys of `LOGOS`, known up front so rows without a mark do not wait for the chunk.
const KNOWN = new Set([
  'Edge',
  'Windows',
  'Apple',
  'Chrome',
  'Safari',
  'Firefox',
  'Opera',
  'Brave',
  'Vivaldi',
  'DuckDuckGo',
  'Arc',
  'Instagram',
  'Facebook',
  'Threads',
  'TikTok',
  'Twitter',
  'Android',
  'Stripe',
  'Lemon Squeezy',
  'Dodo Payments',
  'HTML',
  'React',
  'Next.js',
  'Remix',
  'Vue',
  'Nuxt',
  'Astro',
  'Svelte',
  'Angular',
  'SolidStart',
  'Qwik',
  'Gatsby',
  'Docusaurus',
  'Hugo',
  'Jekyll',
  'Eleventy',
  'WordPress',
  'Shopify',
  'Webflow',
  'Framer',
  'Ghost',
  'Laravel',
  'Ruby on Rails',
  'Django',
  'Flask',
  'Google Tag Manager',
  'Umami',
  'Simple Analytics',
  'Matomo',
  'Google Analytics',
  'PostHog',
  'GoatCounter',
])

/** A small brand mark (browser, operating system, payment provider, framework, analytics tool) in its own colours; decorative. */
export function Logo({ name }: { name: string }) {
  const marks = useLogos()
  const mark = marks?.[ALIASES[name] ?? name]
  if (mark?.startsWith('<svg')) {
    return <img className="analytik-logo" src={`data:image/svg+xml,${encodeURIComponent(mark)}`} alt="" />
  }
  return (
    <svg className="analytik-logo" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {mark && <path d={mark} />}
    </svg>
  )
}
