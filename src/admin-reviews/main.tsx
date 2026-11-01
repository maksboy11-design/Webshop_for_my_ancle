import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installChunkReload } from '../chunkReload'
import { AppErrorBoundary } from '../AppErrorBoundary'

installChunkReload()

const rootEl = document.getElementById('root')!
rootEl.dataset.ok = '1'
createRoot(rootEl).render(
  <StrictMode>
    <AppErrorBoundary hint="Нажмите «Перезагрузить» или откройте окно снова из бота.">
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
