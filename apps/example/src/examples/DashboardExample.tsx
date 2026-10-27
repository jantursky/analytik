import 'analytik/dashboard/styles.css'

import { Dashboard } from 'analytik/dashboard'

import { API_BASE, SITE_ID } from '../config'

// The embeddable dashboard. The demo server signs every request in, so there is no login form,
// and it refuses every write: the data you see is seeded and shared by all visitors.
export function DashboardExample() {
  return (
    <div className="dashboard-host">
      <Dashboard api={API_BASE} siteId={SITE_ID} />
    </div>
  )
}

export default DashboardExample
