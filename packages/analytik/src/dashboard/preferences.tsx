import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react'

import type { ApiClient } from './api'
import { parseFormatSettings, setFormatSettings } from './format'

/**
 * Dashboard settings: the overview layout, live refresh and chart choices. Each feature reads its own key and checks
 * the value itself, so a value saved by another version of the dashboard can't break it.
 */
export type Preferences = Record<string, unknown>

export interface PreferencesState {
  values: Preferences
  /** Merges `patch` in; a key set to `undefined` goes back to its default. */
  update: (patch: Preferences) => void
}

const STORAGE_KEY = 'analytik:preferences'
// Changes in quick succession (moving a block three places) are saved once.
const SAVE_DELAY_MS = 600

function readLocal(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Preferences) : {}
  } catch {
    return {}
  }
}

function writeLocal(values: Preferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(values))
  } catch {
    // Private mode or full storage: the database copy still has them.
  }
}

/** The saved theme, or undefined to follow the page and the system. */
export function parseTheme(value: unknown): 'light' | 'dark' | undefined {
  return value === 'light' || value === 'dark' ? value : undefined
}

const isEmpty = (values: Preferences): boolean => Object.keys(values).length === 0

/**
 * Settings kept in this browser and, given a client, in the database, so every browser an admin signs in from shows
 * the same dashboard. The browser copy shows at once; the database copy replaces it when it arrives, unless something
 * was changed in the meantime. A browser with settings and an empty database uploads its own. Saving fails quietly
 * (a read-only demo, a lost connection): the browser copy stays.
 */
export function usePreferencesStore(client?: ApiClient, enabled = true): PreferencesState {
  const [values, setValues] = useState(readLocal)
  const latest = useRef(values)
  const changed = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    if (!client || !enabled) return
    let gone = false
    client.preferences().then(
      (stored) => {
        if (gone || changed.current) return
        if (!isEmpty(stored)) {
          latest.current = stored
          setValues(stored)
          writeLocal(stored)
        } else if (!isEmpty(latest.current)) {
          void client.savePreferences(latest.current).catch(() => undefined)
        }
      },
      () => undefined,
    )
    return () => {
      gone = true
    }
  }, [client, enabled])

  useEffect(() => () => clearTimeout(timer.current), [])

  const update = (patch: Preferences): void => {
    // Without a client, other parts may have written their own keys to the browser since; keep those.
    const base = client ? latest.current : { ...latest.current, ...readLocal() }
    const next = JSON.parse(JSON.stringify({ ...base, ...patch })) as Preferences
    latest.current = next
    changed.current = true
    setValues(next)
    writeLocal(next)
    if (!client || !enabled) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void client.savePreferences(next).catch(() => undefined), SAVE_DELAY_MS)
  }

  return { values, update }
}

const PreferencesContext = createContext<PreferencesState | undefined>(undefined)

// The formatters are shared functions rather than hooks, so the saved formatting is applied before the parts render.
const applyFormatting = (values: Preferences): void => setFormatSettings(parseFormatSettings(values.format))

export function PreferencesProvider({ value, children }: { value: PreferencesState; children: ReactNode }) {
  applyFormatting(value.values)
  return <PreferencesContext value={value}>{children}</PreferencesContext>
}

/** Provides settings synced through `client`, unless a provider above already does. */
export function OwnPreferences({ client, children }: { client: ApiClient; children: ReactNode }) {
  const outer = useContext(PreferencesContext)
  const own = usePreferencesStore(client, !outer)
  const value = outer ?? own
  applyFormatting(value.values)
  return <PreferencesContext value={value}>{children}</PreferencesContext>
}

/** The dashboard's settings; outside `<Dashboard>` and `<DashboardProvider>` they are kept in this browser only. */
export function usePreferences(): PreferencesState {
  const own = usePreferencesStore()
  return useContext(PreferencesContext) ?? own
}
