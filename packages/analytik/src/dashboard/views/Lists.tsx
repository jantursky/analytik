import { t } from '../i18n'
import { View } from '../ui/motion'
import { BreakdownCard } from './Breakdown'
import { Vitals } from './Vitals'

export function Sources() {
  return (
    <View>
      <BreakdownCard
        title={t('Traffic sources')}
        dimensions={['channel', 'source', 'referrer', 'campaign', 'medium', 'term', 'content', 'ref']}
        limit={50}
      />
    </View>
  )
}

export function Pages() {
  return (
    <View>
      <BreakdownCard title={t('Pages')} dimensions={['page', 'entry', 'exit']} limit={50} />
      <Vitals />
    </View>
  )
}
