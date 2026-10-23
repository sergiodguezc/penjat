import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installSeason } from './seasonal/runtime'
import './seasonal/seasonal.css'

const disposeSeason = installSeason(import.meta.env.DEV ? import.meta.env.VITE_SEASON : undefined)
if (import.meta.hot) import.meta.hot.dispose(disposeSeason)

const root = createRoot(document.getElementById('root')!)
if (import.meta.env.DEV && window.location.pathname === '/dev/seasonal') {
  void import('./seasonal/SeasonalPreview').then(({ SeasonalPreview }) => root.render(<StrictMode><SeasonalPreview /></StrictMode>))
} else root.render(<StrictMode><App /></StrictMode>)
