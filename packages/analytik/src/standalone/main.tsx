import '../dashboard/styles.css'

import { createRoot } from 'react-dom/client'

import { Dashboard } from '../dashboard'

// The page the server sends carries the API path on the root element.
const root = document.getElementById('root')
if (root) createRoot(root).render(<Dashboard api={root.dataset.api ?? '/api'} urlState />)
