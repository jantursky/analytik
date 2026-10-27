import { motion } from 'motion/react'
import { useState } from 'react'

import type { Overview, Site } from '../../shared/types'
import type { ApiClient } from '../api'
import { requestKey } from '../context'
import { useResource } from '../data'
import { formatNumber } from '../format'
import { Icon } from '../icons'
import { SiteTile } from '../ui'
import { rise, View } from '../ui/motion'

const DAY = 86400000

function SiteCard({
  client,
  site,
  since,
  onOpen,
}: {
  client: ApiClient
  site: Site
  since: number
  onOpen: () => void
}) {
  const query = { from: since, to: since + DAY, interval: 'hour' as const, tz: site.timezone, filters: {} }
  const overview = useResource<Overview>(requestKey('site-card', site.id, since), () => client.overview(site.id, query))
  const data = overview.data
  const online = data?.online ?? 0
  const visitors = overview.error ? '–' : data ? formatNumber(data.visitors.value) : '…'
  return (
    <motion.li variants={rise}>
      <button type="button" className="analytik-card analytik-site-card" onClick={onOpen}>
        <span className="analytik-site-name">
          <SiteTile site={site} />
          <span>
            <strong>{site.name}</strong>
            <span className="analytik-muted">{site.domain}</span>
          </span>
        </span>
        <span className="analytik-site-number">{visitors}</span>
        <span className="analytik-muted">visitors in the last 24h</span>
        <span className="analytik-site-online">
          <span className="analytik-live-dot" data-idle={online ? undefined : ''} aria-hidden="true" />
          {formatNumber(online)} online
        </span>
      </button>
    </motion.li>
  )
}

export interface SitesOverviewProps {
  client: ApiClient
  sites: Site[]
  onOpen: (site: Site) => void
  onAdd: () => void
}

/** Every site on a card with its visitors in the last 24 hours and who is online now. */
export function SitesOverview({ client, sites, onOpen, onAdd }: SitesOverviewProps) {
  // Fixed on mount, so the cards don't refetch on every render.
  const [since] = useState(() => Date.now() - DAY)
  return (
    <View>
      <div className="analytik-page-head">
        <h1>Websites</h1>
        <button type="button" className="analytik-button" data-variant="primary" onClick={onAdd}>
          <Icon name="plus" />
          Add website
        </button>
      </div>
      <ul className="analytik-site-grid" aria-label="Websites">
        {sites.map((site) => (
          <SiteCard key={site.id} client={client} site={site} since={since} onOpen={() => onOpen(site)} />
        ))}
      </ul>
    </View>
  )
}
