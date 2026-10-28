import { Menu as BaseMenu } from '@base-ui/react/menu'

import { Icon, type IconName } from '../icons'
import { useLayer } from './layer'

export interface MenuAction {
  label: string
  icon: IconName
  onSelect: () => void
  /** `danger` for actions that delete something, `warning` for ones that stop something, `success` for ones that start it again. */
  tone?: 'danger' | 'warning' | 'success'
}

/** A "more" button opening a list of actions; keyboard and focus handling from Base UI. */
export function ActionMenu({
  label,
  actions,
  className,
}: {
  label: string
  actions: MenuAction[]
  className?: string
}) {
  const layer = useLayer()
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger className={['analytik-icon-button', className].filter(Boolean).join(' ')} aria-label={label}>
        <Icon name="more" />
      </BaseMenu.Trigger>
      <BaseMenu.Portal container={layer.container} className={layer.className}>
        <BaseMenu.Positioner className="analytik-positioner" sideOffset={6} align="end">
          <BaseMenu.Popup className="analytik-popup analytik-menu">
            {actions.map((action) => (
              <BaseMenu.Item
                key={action.label}
                className="analytik-menu-item"
                data-tone={action.tone}
                onClick={action.onSelect}
              >
                <Icon name={action.icon} />
                <span className="analytik-menu-text">{action.label}</span>
              </BaseMenu.Item>
            ))}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  )
}

/** A labelled button with a chevron that opens a list of actions; the primary one for "Add website" and its siblings. */
export function MenuButton({ label, actions, variant }: { label: string; actions: MenuAction[]; variant?: 'primary' }) {
  const layer = useLayer()
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger className="analytik-button" data-variant={variant}>
        {label}
        <Icon name="down" />
      </BaseMenu.Trigger>
      <BaseMenu.Portal container={layer.container} className={layer.className}>
        <BaseMenu.Positioner className="analytik-positioner" sideOffset={6} align="end">
          <BaseMenu.Popup className="analytik-popup analytik-menu">
            {actions.map((action) => (
              <BaseMenu.Item key={action.label} className="analytik-menu-item" onClick={action.onSelect}>
                <Icon name={action.icon} />
                <span className="analytik-menu-text">{action.label}</span>
              </BaseMenu.Item>
            ))}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  )
}
