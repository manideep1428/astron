import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { hubSocket } from './utils/hubSocket'

// Boot-time WS: both Dashboard + Overlay windows connect immediately,
// before any component mounts. Retries until main hub is listening.
hubSocket.connect()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
