import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import type { ReactNode } from 'react'

import { Icon } from '../icons'
import { t } from '../i18n'
import { useLayer } from './layer'

export interface DialogProps {
  open: boolean
  /** Called with `false` on Escape, the close button or a click on the backdrop. */
  onOpenChange: (open: boolean) => void
  title: string
  children: ReactNode
  /** `wide` for content such as a timeline, `large` for a picker with a sidebar. */
  size?: 'wide' | 'large'
  /** A row at the bottom that stays put while the content scrolls, e.g. a note and the buttons. */
  footer?: ReactNode
}

/** A modal dialog: centred on wide screens, a bottom sheet on phones. Focus is trapped and restored on close. */
export function Dialog({ open, onOpenChange, title, children, size, footer }: DialogProps) {
  const layer = useLayer()
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal container={layer.container} className={layer.className}>
        <BaseDialog.Backdrop className="analytik-backdrop" />
        <BaseDialog.Popup className="analytik-dialog" data-size={size}>
          <div className="analytik-dialog-head">
            <BaseDialog.Title className="analytik-dialog-title">{title}</BaseDialog.Title>
            <BaseDialog.Close className="analytik-icon-button" aria-label={t('Close')}>
              <Icon name="close" />
            </BaseDialog.Close>
          </div>
          {footer ? <div className="analytik-dialog-body">{children}</div> : children}
          {footer && <div className="analytik-dialog-foot">{footer}</div>}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}
