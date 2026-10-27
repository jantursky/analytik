import '@fontsource-variable/figtree'
import '@fontsource/geist-mono/400.css'
import './tokens.css'
import './app.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Installable as an app; only the production build registers the worker, so dev reloads stay uncached.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Without the worker the demo still works, just not offline.
    })
  })
}
