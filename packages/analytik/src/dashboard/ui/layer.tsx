import { createContext, use } from 'react'

/**
 * Where popups render. Inside `<Dashboard>` they portal into its root element so they inherit the theme variables;
 * parts rendered on their own fall back to `<body>`, where the `analytik-layer` class brings the default tokens.
 */
export const LayerContext = createContext<HTMLElement | null>(null)

export function useLayer(): { container: HTMLElement | undefined; className: string | undefined } {
  const root = use(LayerContext)
  return root ? { container: root, className: undefined } : { container: undefined, className: 'analytik-layer' }
}
