import 'analytik/dashboard/styles.css'

import { Dashboard } from 'analytik/dashboard'

import { API_BASE, SITE_ID } from '../config'

// The embeddable dashboard. The demo server signs every request in, so there is no login form,
// and it refuses every write: the data you see is seeded and shared by all visitors. The demo site's
// domain is made up, so its tile shows this app's icon instead of asking that domain for a favicon. Layout and chart
// choices stay in each visitor's browser instead of the shared database.
const icon = () => '/icon.svg'

export function DashboardExample() {
  return (
    <div className="dashboard-host">
      <Dashboard api={API_BASE} siteId={SITE_ID} favicons={icon} syncPreferences={false} />
    </div>
  )
}

export default DashboardExample
