import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { type ReactNode, useCallback, useEffect, useRef } from 'react'

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

/**
 * Marks the popup `data-shadow-top` while its content is scrolled down and `data-shadow-bottom` while more waits
 * below, so the sticky heading and button row get a shadow only when something slides under them.
 */
function useScrollShadows() {
  const popup = useRef<HTMLDivElement>(null)
  const update = useCallback(() => {
    const element = popup.current
    if (!element) return
    // A large dialog scrolls its body; the others scroll the popup itself.
    const scroller = element.querySelector<HTMLElement>('.analytik-dialog-body') ?? element
    element.toggleAttribute('data-shadow-top', scroller.scrollTop > 0)
    element.toggleAttribute(
      'data-shadow-bottom',
      scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1,
    )
  }, [])
  useEffect(() => {
    const element = popup.current
    if (!element) return
    update()
    element.addEventListener('scroll', update, { capture: true, passive: true })
    const observer = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(update)
    observer?.observe(element, { childList: true, subtree: true })
    window.addEventListener('resize', update)
    return () => {
      element.removeEventListener('scroll', update, { capture: true })
      observer?.disconnect()
      window.removeEventListener('resize', update)
    }
  })
  return popup
}

/** A modal dialog: centred on wide screens, a bottom sheet on phones. Focus is trapped and restored on close. */
export function Dialog({ open, onOpenChange, title, children, size, footer }: DialogProps) {
  const layer = useLayer()
  const popup = useScrollShadows()
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal container={layer.container} className={layer.className}>
        <BaseDialog.Backdrop className="analytik-backdrop" />
        <BaseDialog.Popup ref={popup} className="analytik-dialog" data-size={size}>
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
