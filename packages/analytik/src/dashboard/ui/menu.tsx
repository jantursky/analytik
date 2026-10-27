import { Menu as BaseMenu } from '@base-ui/react/menu'

import { Icon, type IconName } from '../icons'
import { useLayer } from './layer'

export interface MenuAction {
  label: string
  icon: IconName
  onSelect: () => void
  /** `danger` for actions that delete something. */
  tone?: 'danger'
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
