import { AnimatePresence, motion } from 'motion/react'
import { createContext, type ReactNode, use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { Icon } from '../icons'
import { EASE } from './motion'
import { useLayer } from './layer'

const SHOW_MS = 2400

interface ToastItem {
  id: number
  text: string
  ok: boolean
}

type Toast = (text: string, ok?: boolean) => void

const ToastContext = createContext<Toast | undefined>(undefined)

/** Shows a short message at the bottom of the dashboard, or `undefined` outside a `<ToastProvider>`. */
export const useToast = (): Toast | undefined => use(ToastContext)

/**
 * Brief confirmations ("Copied") shown over the page for a moment and then removed. The stack is a polite live
 * region that is always rendered, so screen readers announce what appears in it.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const next = useRef(0)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const layer = useLayer()
  useEffect(() => {
    const open = timers.current
    return () => {
      for (const timer of open) clearTimeout(timer)
    }
  }, [])
  const show = useCallback<Toast>((text, ok = true) => {
    const id = next.current++
    // The latest message replaces the one before it, so repeated copying doesn't pile up.
    setItems([{ id, text, ok }])
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      setItems((list) => list.filter((item) => item.id !== id))
    }, SHOW_MS)
    timers.current.add(timer)
  }, [])
  const stack = (
    <div className={['analytik-toasts', layer.className].filter(Boolean).join(' ')} role="status" aria-live="polite">
      <AnimatePresence>
        {items.map((item) => (
          <motion.div
            key={item.id}
            className="analytik-toast"
            data-ok={item.ok ? '' : undefined}
            role={item.ok ? undefined : 'alert'}
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96, transition: { duration: 0.15 } }}
            transition={{ duration: 0.25, ease: EASE }}
          >
            {item.ok && <Icon name="check" />}
            {item.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
  const value = useMemo(() => show, [show])
  return (
    <ToastContext value={value}>
      {children}
      {createPortal(stack, layer.container ?? document.body)}
    </ToastContext>
  )
}
