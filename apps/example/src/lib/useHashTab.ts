import { useSyncExternalStore } from 'react'

export const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'full', label: 'Full page' },
  { id: 'site', label: 'Instrumented site' },
  { id: 'install', label: 'Install' },
  { id: 'privacy', label: 'Privacy' },
] as const

export type TabId = (typeof TABS)[number]['id']

const read = (): TabId => TABS.find((tab) => `#${tab.id}` === window.location.hash)?.id ?? 'dashboard'

const subscribe = (notify: () => void) => {
  window.addEventListener('hashchange', notify)
  return () => {
    window.removeEventListener('hashchange', notify)
  }
}

/** The active tab, derived from the URL hash. */
export const useHashTab = (): TabId => useSyncExternalStore(subscribe, read, () => 'dashboard')
