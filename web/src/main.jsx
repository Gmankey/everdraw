import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App, { V5UatExperience } from './App.jsx'

const v5Enabled = import.meta.env.VITE_V5_UAT === 'true' || import.meta.env.VITE_V5_ENABLED === 'true'
const RootApp = v5Enabled ? V5UatExperience : App

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RootApp />
  </StrictMode>,
)
