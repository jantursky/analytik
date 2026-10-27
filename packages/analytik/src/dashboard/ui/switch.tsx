import { Switch as BaseSwitch } from '@base-ui/react/switch'
import { type ReactNode, useId } from 'react'

export interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** The visible label, which is also the accessible name. */
  children: ReactNode
  disabled?: boolean
  className?: string
}

/**
 * An on/off switch with a sliding thumb. Clicking the text toggles it too; the text is not a `<label>`, since a label
 * around a button forwards the button's own clicks back to it.
 */
export function Switch({ checked, onChange, children, disabled, className }: SwitchProps) {
  const id = useId()
  return (
    <span
      className={['analytik-switch-field', className].filter(Boolean).join(' ')}
      data-disabled={disabled ? '' : undefined}
    >
      <BaseSwitch.Root
        className="analytik-switch"
        render={<button type="button" />}
        nativeButton
        checked={checked}
        disabled={disabled}
        aria-labelledby={id}
        onCheckedChange={(next) => onChange(next)}
      >
        <BaseSwitch.Thumb className="analytik-switch-thumb" />
      </BaseSwitch.Root>
      {/* Pointer convenience only: keyboard users reach the switch itself, which carries this text as its name. */}
      <span id={id} onClick={() => !disabled && onChange(!checked)}>
        {children}
      </span>
    </span>
  )
}
