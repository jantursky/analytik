import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'

import { Icon } from './icons'

const EDGE = 2

/**
 * The header's view list. It scrolls sideways when the views do not fit, so the side that hides more is faded out and
 * carries an arrow that moves the list by a page. The arrows are for the pointer: the buttons in the list stay
 * reachable with the keyboard, which scrolls the focused one into view, so the arrows are hidden from assistive tech.
 */
export function NavScroll({ label, active, children }: { label: string; active: string; children: ReactNode }) {
  const scroller = useRef<HTMLElement>(null)
  const [edges, setEdges] = useState({ left: false, right: false })

  const update = useCallback((): void => {
    const element = scroller.current
    if (!element) return
    const left = element.scrollLeft > EDGE
    const right = element.scrollLeft < element.scrollWidth - element.clientWidth - EDGE
    setEdges((previous) => (previous.left === left && previous.right === right ? previous : { left, right }))
  }, [])

  useEffect(() => {
    const element = scroller.current
    if (!element) return
    update()
    element.addEventListener('scroll', update, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update)
    observer?.observe(element)
    if (element.firstElementChild) observer?.observe(element.firstElementChild)
    return () => {
      element.removeEventListener('scroll', update)
      observer?.disconnect()
    }
  }, [update])

  // The open view is brought into the visible part of the list when it changes, from a shortcut or the address too.
  useEffect(() => {
    const element = scroller.current
    const current = element?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!element || !current) return
    const box = current.getBoundingClientRect()
    const start = box.left - element.getBoundingClientRect().left + element.scrollLeft
    const end = start + box.width
    const margin = 48
    if (start - margin < element.scrollLeft) element.scrollTo({ left: Math.max(0, start - margin) })
    else if (end + margin > element.scrollLeft + element.clientWidth) {
      element.scrollTo({ left: end + margin - element.clientWidth })
    }
  }, [active])

  const page = (direction: -1 | 1): void => {
    const element = scroller.current
    const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
    element?.scrollBy({ left: direction * element.clientWidth * 0.7, behavior: reduced ? 'auto' : 'smooth' })
  }

  return (
    <div className="analytik-nav-wrap">
      <span className="analytik-nav-fade" data-side="start" data-on={edges.left || undefined} aria-hidden="true" />
      <span className="analytik-nav-fade" data-side="end" data-on={edges.right || undefined} aria-hidden="true" />
      <button
        type="button"
        className="analytik-nav-arrow"
        data-side="start"
        data-on={edges.left || undefined}
        tabIndex={-1}
        aria-hidden="true"
        onClick={() => page(-1)}
      >
        <Icon name="prev" />
      </button>
      <button
        type="button"
        className="analytik-nav-arrow"
        data-side="end"
        data-on={edges.right || undefined}
        tabIndex={-1}
        aria-hidden="true"
        onClick={() => page(1)}
      >
        <Icon name="next" />
      </button>
      <nav aria-label={label} ref={scroller}>
        {children}
      </nav>
    </div>
  )
}
