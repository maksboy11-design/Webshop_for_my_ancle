import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Component, type ReactNode } from 'react'
import App from './App'
import { getWebApp } from './maxBridge'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
  render() {
    if (this.state.error)
      return (
        <p style={{ font: '16px/1.4 system-ui, sans-serif', padding: 24, color: '#900' }}>
          Ошибка приложения: {this.state.error}. Закройте окно и откройте снова из бота.
        </p>
      )
    return this.props.children
  }
}
import '@fontsource-variable/inter/index.css'

const rootEl = document.getElementById('root')!
rootEl.dataset.ok = '1'
try {
  getWebApp()?.ready()
} catch {
  /* bridge недоступен */
}
createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
