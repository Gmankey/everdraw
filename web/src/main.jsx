import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import V5UatApp from './V5UatApp.jsx'

const RootApp = import.meta.env.VITE_V5_UAT === 'true' ? V5UatApp : App

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RootApp />
  </StrictMode>,
)
