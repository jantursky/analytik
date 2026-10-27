import { useEffect, useRef, useState } from 'react'

import { ExampleFrame } from './components'
import dashboardSource from './examples/DashboardExample.tsx?raw'
import installSource from './examples/InstallExample.tsx?raw'
import privacySource from './examples/PrivacyExample.tsx?raw'
import shopSource from './examples/ShopExample.tsx?raw'
import { DashboardExample } from './examples/DashboardExample'
import { InstallExample } from './examples/InstallExample'
import { PrivacyExample } from './examples/PrivacyExample'
import { ShopExample } from './examples/ShopExample'
import { TABS, useHashTab, type TabId } from './lib/useHashTab'

const DOCS_URL = 'https://analytik-docs.vercel.app'

type Theme = 'system' | 'light' | 'dark'

const NEXT_THEME: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' }

const THEME_KEY = 'analytik-demo-theme'

function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    return saved === 'light' || saved === 'dark' ? saved : 'system'
  } catch {
    return 'system'
  }
}

/** The page theme, kept in this browser. The dashboard picks it up from the data-theme on the page. */
function useTheme() {
  const [theme, setTheme] = useState<Theme>(readTheme)
  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.dataset.theme = theme
    try {
      if (theme === 'system') localStorage.removeItem(THEME_KEY)
      else localStorage.setItem(THEME_KEY, theme)
    } catch {
      // Private mode: the theme just isn't remembered.
    }
  }, [theme])
  return [
    theme,
    () => {
      setTheme(NEXT_THEME[theme])
    },
  ] as const
}

/** Publishes the sticky header's height as --header-height, so the dashboard's own sticky bars sit below it. */
function useHeaderHeight() {
  const header = useRef<HTMLElement>(null)
  useEffect(() => {
    const element = header.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() =>
      document.documentElement.style.setProperty('--header-height', `${element.offsetHeight}px`),
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return header
}

export function App() {
  const tab = useHashTab()
  const header = useHeaderHeight()
  // The tab on screen lags the URL while the previous tab plays its exit animation.
  const [shown, setShown] = useState<TabId>(tab)
  const [theme, cycleTheme] = useTheme()
  return (
    <>
      <header className="header" ref={header}>
        <div className="header__inner">
          <div className="brand">
            <img src="/icon.svg" alt="" />
            <span>
              analytik <small>demo</small>
            </span>
          </div>
          <nav className="nav" aria-label="Demo sections">
            {TABS.map(({ id, label }) => (
              <a key={id} href={`#${id}`} aria-current={tab === id ? 'page' : undefined}>
                {label}
              </a>
            ))}
          </nav>
          <div className="header__actions">
            <button type="button" className="btn" onClick={cycleTheme}>
              Theme: {theme}
            </button>
            <a className="btn btn--primary" href={DOCS_URL}>
              <span className="wide-only">Read the docs</span>
              <span className="narrow-only">Docs</span>
            </a>
          </div>
        </div>
      </header>

      <main
        key={shown}
        className="main"
        data-state={shown === tab ? 'open' : 'closed'}
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget && shown !== tab) setShown(tab)
        }}
      >
        {shown === 'dashboard' && (
          <>
            <div className="stack">
              <h1 className="title">The dashboard, reading live data</h1>
              <p className="lede">
                Seeded traffic for a fictional shop, plus anything you do in the Instrumented site tab. This demo is
                read-only and resets when the server restarts.
              </p>
            </div>
            <ExampleFrame
              title="Dashboard"
              description="The embeddable React dashboard, pointed at this app's own analytik server."
              file="DashboardExample.tsx"
              source={dashboardSource}
            >
              <DashboardExample />
            </ExampleFrame>
          </>
        )}

        {shown === 'site' && (
          <>
            <div className="stack">
              <h1 className="title">A shop that reports to analytik</h1>
              <p className="lede">
                Fernwood is a made-up indie writing app. Pageviews, button goals and the purchase revenue event are sent
                with analytik/react. Toggle consent to move between strict and enriched mode.
              </p>
            </div>
            <ExampleFrame
              title="Instrumented storefront"
              description="Landing, pricing, checkout stub and thank-you page, with a consent switch."
              file="ShopExample.tsx"
              source={shopSource}
            >
              <ShopExample />
            </ExampleFrame>
          </>
        )}

        {shown === 'install' && (
          <>
            <div className="stack">
              <h1 className="title">Install it on your site</h1>
              <p className="lede">
                Three steps from nothing to your first pageview. Or copy a prompt and let your coding assistant do it.
              </p>
            </div>
            <ExampleFrame
              title="Install analytik"
              description="The steps, a snippet generator and prompts for coding assistants, all built from the same options."
              file="InstallExample.tsx"
              source={installSource}
            >
              <InstallExample />
            </ExampleFrame>
          </>
        )}

        {shown === 'privacy' && (
          <>
            <div className="stack">
              <h1 className="title">What each mode stores</h1>
              <p className="lede">Pick a mode, then see how the visitor id is made and what sits on this device.</p>
            </div>
            <ExampleFrame
              title="Privacy explainer"
              description="Strict, enriched and persistent side by side, with a working id derivation."
              file="PrivacyExample.tsx"
              source={privacySource}
            >
              <PrivacyExample />
            </ExampleFrame>
          </>
        )}
      </main>
    </>
  )
}
