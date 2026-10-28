import { Menu } from '@base-ui/react/menu'

import { Icon } from './icons'
import { currentLanguage, LANGUAGES, t } from './i18n'
import { usePreferences } from './preferences'
import { useLayer } from './ui/layer'

const BROWSER = 'browser'

/**
 * A button in the header, beside the theme switch, that opens the list of languages. It writes the same setting as
 * Settings, Appearance, Language; "Browser language" goes back to following the browser.
 */
export function LanguageSwitch() {
  const { values, update } = usePreferences()
  const layer = useLayer()
  const saved = LANGUAGES.some((l) => l.value === values.language) ? (values.language as string) : BROWSER
  return (
    <Menu.Root>
      <Menu.Trigger
        className="analytik-pill-icon analytik-language-switch"
        aria-label={t('Language')}
        title={t('Language')}
      >
        <Icon name="globe" />
        <span className="analytik-language-code" aria-hidden="true">
          {currentLanguage()}
        </span>
      </Menu.Trigger>
      <Menu.Portal container={layer.container} className={layer.className}>
        <Menu.Positioner className="analytik-positioner" sideOffset={6} align="end">
          <Menu.Popup className="analytik-popup analytik-menu">
            <Menu.RadioGroup
              value={saved}
              onValueChange={(value) => update({ language: value === BROWSER ? undefined : value })}
            >
              {[{ value: BROWSER, label: t('Browser language') }, ...LANGUAGES].map(({ value, label }) => (
                <Menu.RadioItem key={value} value={value} className="analytik-menu-item" closeOnClick>
                  <span className="analytik-menu-text">{label}</span>
                  <Menu.RadioItemIndicator keepMounted={false}>
                    <Icon name="check" />
                  </Menu.RadioItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
