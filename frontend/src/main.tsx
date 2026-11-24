import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@primer/primitives/dist/css/primitives.css'
import '@primer/primitives/dist/css/functional/themes/dark.css'
import './app/theme.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
