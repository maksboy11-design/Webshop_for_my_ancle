import { Component, type ReactNode } from 'react'
import { tryReloadForChunkError } from './chunkReload'

/** Перезагрузка в обход кеша webview: новый ?r= сохраняет остальные параметры и #hash (там initData MAX). */
export function hardReload(): void {
  try {
    const u = new URL(window.location.href)
    u.searchParams.set('r', String(Date.now()))
    window.location.replace(u.toString())
  } catch {
    window.location.reload()
  }
}

const box = { font: '16px/1.4 system-ui, -apple-system, sans-serif', padding: 24, color: '#1f2a1f' } as const

/** Ошибка рендера → сообщение и кнопка перезагрузки вместо белого экрана. */
export class AppErrorBoundary extends Component<{ children: ReactNode; hint?: string }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(e: unknown) {
    if (tryReloadForChunkError(e)) return { error: 'reloading' }
    return { error: e instanceof Error ? e.message : String(e) }
  }
  componentDidCatch(e: unknown) {
    console.error('app_crash', e)
  }
  render() {
    if (this.state.error === 'reloading') return <p style={box}>Обновляем приложение…</p>
    if (this.state.error)
      return (
        <div style={box} role="alert" data-testid="app-crash">
          <p style={{ margin: '0 0 12px', color: '#900' }}>Что-то пошло не так. {this.props.hint ?? ''}</p>
          <p style={{ margin: '0 0 16px', fontSize: 13, opacity: 0.7, wordBreak: 'break-word' }}>{this.state.error}</p>
          <button type="button" onClick={hardReload} style={{ font: 'inherit', padding: '10px 18px', borderRadius: 10, border: 0, background: '#2f5d34', color: '#fff' }}>
            Перезагрузить
          </button>
        </div>
      )
    return this.props.children
  }
}
