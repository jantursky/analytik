import { animate, motion, useReducedMotionConfig, type Variants } from 'motion/react'
import { type ReactNode, useEffect, useRef, useState } from 'react'

/** A soft ease-out used by every entrance. */
export const EASE = [0.22, 1, 0.36, 1] as const

/** Children with `variants={rise}` fade up one after another when their parent enters. */
export const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
  exit: { opacity: 0, transition: { duration: 0.12 } },
}

export const rise: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE } },
}

/** A dashboard view: fades in its cards in turn and fades out when another view replaces it. */
export function View({ children }: { children: ReactNode }) {
  return (
    <motion.div className="analytik-view" variants={stagger} initial="hidden" animate="show" exit="exit">
      {children}
    </motion.div>
  )
}

/** A number that tweens to each new value; the first value shows at once. */
export function AnimatedNumber({ value, format }: { value: number; format: (value: number) => string }) {
  const [shown, setShown] = useState(value)
  // The value on screen right now, so a tween interrupted by a newer value continues from where it is.
  const current = useRef(value)
  const reduced = useReducedMotionConfig()

  useEffect(() => {
    const show = (next: number): void => {
      current.current = next
      setShown(next)
    }
    if (current.current === value) return
    if (reduced) {
      show(value)
      return
    }
    const controls = animate(current.current, value, {
      duration: 0.6,
      ease: EASE,
      onUpdate: show,
      onComplete: () => show(value),
    })
    return () => controls.stop()
  }, [value, reduced])

  return <>{format(shown)}</>
}
