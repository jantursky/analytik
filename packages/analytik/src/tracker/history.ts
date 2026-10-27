/** Dispatched on `window` after `history.pushState` and `history.replaceState`. */
export const NAVIGATE = 'analytik:navigate'

/** Makes History API navigation observable. Patches once per window, so several clients can share it. */
export function patchHistory(): void {
  const h = history as History & { analytik?: true }
  if (h.analytik) return
  h.analytik = true
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = h[method].bind(h)
    h[method] = (...args) => {
      original(...args)
      dispatchEvent(new Event(NAVIGATE))
    }
  }
}
