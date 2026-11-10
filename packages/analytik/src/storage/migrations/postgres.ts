import type { Migration } from '../types'
import { init } from './0001_init'
import { imported } from './0002_imported'
import { ignoreAdmins } from './0003_ignore_admins'
import { botRequests } from './0004_bot_requests'
import { notifications } from './0005_notifications'
import { shareLinks } from './0006_share_links'
import { annotations } from './0007_annotations'
import { goalTargets } from './0008_goal_targets'
import { vitals } from './0009_vitals'
import { siteSync } from './0010_site_sync'
import { hotIndexes } from './0011_hot_indexes'
import { eventNameIndex } from './0012_event_name_index'
import { outboundWebhooks } from './0013_outbound_webhooks'

/** Postgres (Supabase, Neon or self-hosted), applied in order and recorded in `schema_migrations`. */
export const migrations: readonly Migration[] = [
  { version: '0001_init', sql: init({ big: 'BIGINT', real: 'DOUBLE PRECISION' }) },
  { version: '0002_imported', sql: imported() },
  { version: '0003_ignore_admins', sql: ignoreAdmins() },
  { version: '0004_bot_requests', sql: botRequests({ big: 'BIGINT' }) },
  { version: '0005_notifications', sql: notifications({ big: 'BIGINT' }) },
  { version: '0006_share_links', sql: shareLinks({ big: 'BIGINT' }) },
  { version: '0007_annotations', sql: annotations({ big: 'BIGINT' }) },
  { version: '0008_goal_targets', sql: goalTargets() },
  { version: '0009_vitals', sql: vitals({ big: 'BIGINT', real: 'DOUBLE PRECISION' }) },
  { version: '0010_site_sync', sql: siteSync() },
  { version: '0011_hot_indexes', sql: hotIndexes() },
  { version: '0012_event_name_index', sql: eventNameIndex() },
  { version: '0013_outbound_webhooks', sql: outboundWebhooks({ big: 'BIGINT' }) },
]
