import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/base.css'
import App from './App.tsx'
import { loadLiveProducts } from './cms/liveProducts'
import { installChunkReload } from './chunkReload'
import { AppErrorBoundary } from './AppErrorBoundary'

installChunkReload()

void loadLiveProducts()

const rootEl = document.getElementById('root')!
rootEl.dataset.ok = '1'
createRoot(rootEl).render(
  <StrictMode>
    <AppErrorBoundary hint="Нажмите «Перезагрузить».">
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
