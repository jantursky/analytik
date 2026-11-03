import { motion } from 'motion/react'

import type { TargetPeriod, TargetProgress, TargetsResult } from '../../shared/types'
import { requestKey, useDashboard } from '../context'
import { useResource } from '../data'
import { formatNumber, formatPercent } from '../format'
import { msg, t } from '../i18n'
import { EASE } from '../ui/motion'

/** What each period is called on a target, and in the settings list. */
export const PERIOD_LABELS: Record<TargetPeriod, string> = {
  week: msg('This week'),
  month: msg('This month'),
  quarter: msg('This quarter'),
}

function Target({ target, index }: { target: TargetProgress; index: number }) {
  const share = target.count / target.target
  const figures = t('{count} of {target}', { count: formatNumber(target.count), target: formatNumber(target.target) })
  return (
    <li className="analytik-target">
      <div className="analytik-target-head">
        <strong className="analytik-target-name">{target.goal}</strong>
        <span className="analytik-muted">{t(PERIOD_LABELS[target.period])}</span>
      </div>
      <div
        className="analytik-target-track"
        role="progressbar"
        aria-label={target.goal}
        aria-valuemin={0}
        aria-valuemax={target.target}
        aria-valuenow={Math.min(target.count, target.target)}
        aria-valuetext={figures}
      >
        <motion.span
          className="analytik-target-value"
          data-reached={share >= 1 ? '' : undefined}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: Math.min(1, share) }}
          transition={{ duration: 0.6, ease: EASE, delay: index * 0.06 }}
        />
      </div>
      <div className="analytik-target-figures">
        <span>{figures}</span>
        <strong>{formatPercent(share)}</strong>
      </div>
      {target.projection !== null && (
        <p className="analytik-target-pace analytik-muted">
          {t('On pace for about {count} (an estimate)', { count: formatNumber(target.projection) })}
        </p>
      )}
    </li>
  )
}

function TargetList() {
  const { client, site } = useDashboard()
  // The key holds the targets, so a saved change in Settings loads the new list right away.
  const result = useResource<TargetsResult>(requestKey('targets', site.id, JSON.stringify(site.targets)), () =>
    client.targets(site.id),
  )
  // Progress is an extra above the breakdown: while it loads, or if it fails, the card shows the breakdown alone.
  const targets = result.data?.targets ?? []
  if (targets.length === 0) return null
  return (
    <ul className="analytik-targets" aria-label={t('Goal targets')}>
      {targets.map((target, index) => (
        <Target key={`${target.goal}-${target.period}`} target={target} index={index} />
      ))}
    </ul>
  )
}

/** Progress to the site's goal targets, in their own periods; nothing when the site has none. */
export function GoalTargets() {
  const { site, readOnly } = useDashboard()
  // A shared dashboard leaves out the site's settings, and a target is one of them.
  return !readOnly && site.targets.length > 0 ? <TargetList /> : null
}
