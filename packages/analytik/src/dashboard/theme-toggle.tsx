import { Icon, type IconName } from './icons'
import { parseTheme, usePreferences } from './preferences'

const NEXT = { system: 'light', light: 'dark', dark: 'system' } as const
const ICON: Record<keyof typeof NEXT, IconName> = { system: 'desktop', light: 'sun', dark: 'moon' }
const LABEL = { system: 'Same as the page', light: 'Light', dark: 'Dark' }

/** One button that cycles the theme: same as the page, light, dark. It writes the same setting as Settings, Appearance. */
export function ThemeToggle() {
  const { values, update } = usePreferences()
  const current = parseTheme(values.theme) ?? 'system'
  const next = NEXT[current]
  return (
    <button
      type="button"
      className="analytik-pill-icon analytik-theme-toggle"
      aria-label={`Theme: ${LABEL[current]}. Switch to ${LABEL[next].toLowerCase()}`}
      title={`Theme: ${LABEL[current]}`}
      onClick={() => update({ theme: next === 'system' ? undefined : next })}
    >
      <Icon name={ICON[current]} />
    </button>
  )
}
