import { Select as BaseSelect } from '@base-ui/react/select'
import type { ReactNode } from 'react'

import { Icon } from '../icons'
import { useLayer } from './layer'

export interface SelectOption<T extends string> {
  value: T
  label: string
  /** A second line in the list, e.g. a site's domain. */
  description?: string
  /** Shown before the label in the list, e.g. a site tile. */
  icon?: ReactNode
}

export interface SelectProps<T extends string> {
  /** Shown above the trigger, or used as its accessible name with `hideLabel`. */
  label: string
  hideLabel?: boolean
  value: T
  options: readonly SelectOption<T>[]
  onChange: (value: T) => void
  /** Extra class on the trigger, e.g. `analytik-pill`. */
  className?: string
  /** Rendered before the value inside the trigger, e.g. a site tile. */
  leading?: ReactNode
  disabled?: boolean
}

/** A listbox select on Base UI: keyboard, typeahead and focus handling included; styled by `analytik-select`. */
export function Select<T extends string>({
  label,
  hideLabel,
  value,
  options,
  onChange,
  className,
  leading,
  disabled,
}: SelectProps<T>) {
  const layer = useLayer()
  const select = (
    <BaseSelect.Root<T>
      value={value}
      items={options}
      disabled={disabled}
      onValueChange={(next) => {
        if (next != null) onChange(next)
      }}
    >
      {!hideLabel && <BaseSelect.Label className="analytik-field-label">{label}</BaseSelect.Label>}
      <BaseSelect.Trigger
        className={['analytik-select', className].filter(Boolean).join(' ')}
        aria-label={hideLabel ? label : undefined}
      >
        {leading}
        <BaseSelect.Value className="analytik-select-value" />
        <BaseSelect.Icon className="analytik-select-icon">
          <Icon name="down" />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal container={layer.container} className={layer.className}>
        <BaseSelect.Positioner
          className="analytik-positioner"
          sideOffset={6}
          align="start"
          alignItemWithTrigger={false}
        >
          <BaseSelect.Popup className="analytik-popup analytik-menu">
            <BaseSelect.List>
              {options.map((option) => (
                <BaseSelect.Item key={option.value} value={option.value} className="analytik-menu-item">
                  {option.icon}
                  <span className="analytik-menu-text">
                    <BaseSelect.ItemText>{option.label}</BaseSelect.ItemText>
                    {option.description && <span className="analytik-menu-description">{option.description}</span>}
                  </span>
                  <BaseSelect.ItemIndicator className="analytik-menu-check">
                    <Icon name="check" />
                  </BaseSelect.ItemIndicator>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  )
  return hideLabel ? select : <div className="analytik-field">{select}</div>
}
