import { View } from '../ui/motion'
import { BreakdownCard } from './Breakdown'

export function Sources() {
  return (
    <View>
      <BreakdownCard
        title="Sources"
        dimensions={['channel', 'source', 'referrer', 'campaign', 'medium', 'term', 'content', 'ref']}
        limit={50}
      />
    </View>
  )
}

export function Pages() {
  return (
    <View>
      <BreakdownCard title="Pages" dimensions={['page', 'entry', 'exit']} limit={50} />
    </View>
  )
}
