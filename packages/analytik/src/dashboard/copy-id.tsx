import { AnimatePresence, motion } from 'motion/react'
import { type KeyboardEvent, type MouseEvent, useEffect, useState } from 'react'

import { useDashboard } from './context'
import { Icon, type IconName } from './icons'
import { t } from './i18n'

const COPIED_MS = 1600

/**
 * A small icon button that copies `text`; the icon turns into a green check for a moment once copied. Revealed when
 * its row is pointed at (see `.analytik-cell-actions`). `nested` makes it a span with a button role, for use inside
 * another button such as a bar row.
 */
export function CopyId({ text, label, nested }: { text: string; label: string; nested?: boolean }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copied])
  const copy = (): void => void navigator.clipboard.writeText(text).then(() => setCopied(true))
  const icon: IconName = copied ? 'check' : 'copy'
  const props = {
    className: 'analytik-cell-action',
    'data-done': copied ? '' : undefined,
    'aria-label': copied ? t('Copied') : label,
    title: label,
    onClick: (event: MouseEvent): void => {
      // A click on the copy button must not also open the row or apply its filter.
      event.stopPropagation()
      copy()
    },
  }
  const mark = (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={icon}
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.5 }}
        transition={{ type: 'spring', stiffness: 500, damping: 26 }}
      >
        <Icon name={icon} />
      </motion.span>
    </AnimatePresence>
  )
  if (!nested) {
    return (
      <button type="button" {...props}>
        {mark}
      </button>
    )
  }
  return (
    <span
      role="button"
      tabIndex={0}
      {...props}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        copy()
      }}
    >
      {mark}
    </span>
  )
}

/** The full address of a page path (`/pricing` on `example.com`); an address that is already full stays as it is. */
export function pageUrl(domain: string, target: string | null | undefined): string | null {
  if (!target) return null
  if (target.startsWith('/')) return `https://${domain}${target}`
  return /^https?:\/\//i.test(target) ? target : null
}

/** A copy button for the full address of a page path, revealed with its row; nothing when `target` is no address. */
export function CopyPageUrl({ target }: { target: string | null | undefined }) {
  const { site } = useDashboard()
  const url = pageUrl(site.domain, target)
  if (!url) return null
  return (
    <span className="analytik-cell-actions">
      <CopyId text={url} label={t('Copy URL')} />
    </span>
  )
}
