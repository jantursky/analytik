import { useEffect, useRef, useState } from 'react'

import type { DashboardView } from './Dashboard'

/** `g` then one of these letters goes to a view. */
export const GO_KEYS: Record<string, DashboardView> = {
  a: 'sites',
  o: 'overview',
  c: 'sources',
  p: 'pages',
  e: 'events',
  f: 'funnels',
  r: 'revenue',
  s: 'sessions',
  l: 'realtime',
  t: 'settings',
}

/** How long the second key of `g` + letter may take. */
const CHORD_MS = 1000

export interface ShortcutActions {
  go: (view: DashboardView) => void
  /** Moves the range back (-1) or forward (1) by its own length. */
  step: (direction: -1 | 1) => void
  refresh: () => void
  help: () => void
  palette: () => void
}

/** Keys typed into a field, or a button-like control being operated, belong to that control. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/** An open dialog, menu or list popup: the keys are for it. */
const popupOpen = (root: HTMLElement): boolean =>
  root.querySelector('[role="dialog"], [role="menu"], [role="listbox"]') !== null

/**
 * Shortcuts on the dashboard's root, so they never reach a host page's own keys: ⌘K or Ctrl+K opens the palette,
 * `g` then a letter goes to a view, `[` and `]` step the range, `r` refreshes and `?` lists them. They are ignored while
 * typing in a field, with ctrl, alt or the command key held for anything but ⌘K, and while a dialog or menu is open.
 * When the dashboard owns the page (`global`), keys pressed with nothing focused count too. Returns the first key of
 * a started chord, to show as a hint.
 */
export function useShortcuts(
  root: HTMLElement | null,
  actions: ShortcutActions,
  { enabled, global }: { enabled: boolean; global: boolean },
): string | null {
  const [pending, setPending] = useState<string | null>(null)
  const latest = useRef(actions)
  useEffect(() => {
    latest.current = actions
  })

  useEffect(() => {
    if (!root || !enabled) return
    let timer: ReturnType<typeof setTimeout> | undefined
    // Whether `g` was just pressed and a view letter is expected.
    const chord = { active: false }
    const clear = (): void => {
      clearTimeout(timer)
      setPending(null)
    }
    const listen = (event: KeyboardEvent): void => {
      const target = event.target
      const inside = target instanceof Node && root.contains(target)
      const bare = target === document.body || target === document.documentElement
      if (event.defaultPrevented || (!inside && !(global && bare))) return
      const run = latest.current

      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        clear()
        run.palette()
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(target) || popupOpen(root)) return

      if (chord.active) {
        chord.active = false
        const view = GO_KEYS[event.key.toLowerCase()]
        clear()
        if (view) {
          event.preventDefault()
          run.go(view)
        }
        return
      }
      switch (event.key) {
        case 'g':
          chord.active = true
          setPending('g')
          timer = setTimeout(() => {
            chord.active = false
            setPending(null)
          }, CHORD_MS)
          break
        case '[':
          run.step(-1)
          break
        case ']':
          run.step(1)
          break
        case 'r':
          run.refresh()
          break
        case '?':
          event.preventDefault()
          run.help()
          break
      }
    }
    document.addEventListener('keydown', listen)
    return () => {
      document.removeEventListener('keydown', listen)
      clearTimeout(timer)
    }
  }, [root, enabled, global])

  return pending
}
