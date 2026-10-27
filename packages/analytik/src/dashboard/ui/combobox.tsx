import { Combobox as BaseCombobox } from '@base-ui/react/combobox'
import { useId } from 'react'

import { Icon } from '../icons'
import { useLayer } from './layer'

export interface ComboboxProps {
  label: string
  value: string
  /** Every choice; the list shows the ones matching what was typed. */
  options: readonly string[]
  onChange: (value: string) => void
  placeholder?: string
}

// Keeps long lists (some 400 time zones) quick to render; typing narrows them down.
const LIMIT = 60

/** A text input that filters a list of string choices, e.g. time zones. */
export function Combobox({ label, value, options, onChange, placeholder }: ComboboxProps) {
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
        onValueChange={(next) => {
          if (next) onChange(next)
        }}
      >
        <BaseCombobox.InputGroup className="analytik-combobox">
          <BaseCombobox.Input id={id} className="analytik-input" placeholder={placeholder} />
          <BaseCombobox.Trigger className="analytik-combobox-trigger" aria-label={`Show ${label.toLowerCase()} list`}>
            <Icon name="down" />
          </BaseCombobox.Trigger>
        </BaseCombobox.InputGroup>
        <BaseCombobox.Portal container={layer.container} className={layer.className}>
          <BaseCombobox.Positioner className="analytik-positioner" sideOffset={6} align="start">
            <BaseCombobox.Popup className="analytik-popup analytik-menu analytik-combobox-popup">
              <BaseCombobox.Empty className="analytik-menu-empty">No matches</BaseCombobox.Empty>
              <BaseCombobox.List>
                {(option: string) => (
                  <BaseCombobox.Item key={option} value={option} className="analytik-menu-item">
                    {option}
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
    </div>
  )
}
