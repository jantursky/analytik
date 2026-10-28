import { Combobox as BaseCombobox } from '@base-ui/react/combobox'
import { type ReactNode, useId } from 'react'

import { Icon } from '../icons'
import { t } from '../i18n'
import { useLayer } from './layer'

export interface ComboboxChoice {
  /** Shown in the input once chosen and matched against what is typed. */
  label: string
  /** A second, quieter line in the list. */
  detail?: string
  /** Shown before the text in the list, e.g. a currency symbol. */
  leading?: ReactNode
}

export interface ComboboxProps {
  label: string
  value: string
  /** Every choice; the list shows the ones matching what was typed. */
  options: readonly string[]
  onChange: (value: string) => void
  placeholder?: string
  hint?: string
  /** How a choice reads in the list and the input. Default: the value itself. */
  describe?: (value: string) => ComboboxChoice
}

// Keeps long lists (some 400 time zones) quick to render; typing narrows them down.
const LIMIT = 60

/** A text input that filters a list of choices, e.g. time zones or currencies. */
export function Combobox({ label, value, options, onChange, placeholder, hint, describe }: ComboboxProps) {
  const id = useId()
  const layer = useLayer()
  return (
    <div className="analytik-field">
      <label className="analytik-field-label" htmlFor={id}>
        {label}
      </label>
      <BaseCombobox.Root<string>
        items={options}
        value={value}
        limit={LIMIT}
        itemToStringLabel={describe && ((option) => describe(option).label)}
        onValueChange={(next) => {
          if (next) onChange(next)
        }}
      >
        <BaseCombobox.InputGroup className="analytik-combobox">
          <BaseCombobox.Input id={id} className="analytik-input" placeholder={placeholder} />
          <BaseCombobox.Trigger
            className="analytik-combobox-trigger"
            aria-label={t('Show {label} list', { label: label.toLowerCase() })}
          >
            <Icon name="down" />
          </BaseCombobox.Trigger>
        </BaseCombobox.InputGroup>
        <BaseCombobox.Portal container={layer.container} className={layer.className}>
          <BaseCombobox.Positioner className="analytik-positioner" sideOffset={6} align="start">
            <BaseCombobox.Popup className="analytik-popup analytik-menu analytik-combobox-popup">
              <BaseCombobox.Empty className="analytik-menu-empty">{t('No matches')}</BaseCombobox.Empty>
              <BaseCombobox.List>
                {(option: string) => (
                  <BaseCombobox.Item key={option} value={option} className="analytik-menu-item">
                    {describe ? <Choice {...describe(option)} /> : option}
                    <BaseCombobox.ItemIndicator className="analytik-menu-check">
                      <Icon name="check" />
                    </BaseCombobox.ItemIndicator>
                  </BaseCombobox.Item>
                )}
              </BaseCombobox.List>
            </BaseCombobox.Popup>
          </BaseCombobox.Positioner>
        </BaseCombobox.Portal>
      </BaseCombobox.Root>
      {hint && <span className="analytik-field-hint">{hint}</span>}
    </div>
  )
}

function Choice({ label, detail, leading }: ComboboxChoice) {
  return (
    <>
      {leading}
      <span className="analytik-menu-text">
        <span>{label}</span>
        {detail && <span className="analytik-menu-description">{detail}</span>}
      </span>
    </>
  )
}
