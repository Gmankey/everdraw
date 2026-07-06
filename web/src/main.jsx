import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App, { V5UatExperience } from './App.jsx'

const RootApp = import.meta.env.VITE_V5_UAT === 'true' ? V5UatExperience : App

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RootApp />
  </StrictMode>,
)
