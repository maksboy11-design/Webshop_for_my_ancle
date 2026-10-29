/** Типы и обёртка над документированным MAX Bridge (window.WebApp). Без выдуманных методов. */

export interface MaxWebAppBackButton {
  isVisible: boolean
  onClick: (cb: (...args: unknown[]) => unknown) => void
  offClick: (cb: (...args: unknown[]) => unknown) => void
  show: () => void
  hide: () => void
}

export interface MaxWebApp {
  initData: string
  initDataUnsafe: Record<string, unknown>
  platform: string
  version: string
  BackButton: MaxWebAppBackButton
  ready: () => void
  expand?: () => void
  enableClosingConfirmation?: () => void
  disableClosingConfirmation?: () => void
  openMaxLink?: (url: string) => void
  openLink?: (url: string, options?: { try_instant_view?: boolean }) => void
}

export type BridgeState = 'loading' | 'ready' | 'error'

declare global {
  interface Window {
    WebApp?: MaxWebApp
    /** Состояние асинхронной загрузки bridge (см. admin-reviews.html). */
    __maxBridge?: { state: BridgeState }
    __loadMaxBridge?: () => void
  }
}

/** Текущее состояние загрузки bridge: по событиям загрузчика, без опроса. */
export function getBridgeState(): BridgeState {
  if (typeof window === 'undefined') return 'error'
  if (window.WebApp) return 'ready'
  return window.__maxBridge?.state ?? 'loading'
}

/** Подписка на изменение состояния bridge (событие "maxbridge" от загрузчика). */
export function onBridgeChange(cb: (state: BridgeState) => void): () => void {
  const handler = () => cb(getBridgeState())
  window.addEventListener('maxbridge', handler)
  return () => window.removeEventListener('maxbridge', handler)
}

/** Повторная загрузка bridge после ошибки/таймаута. */
export function retryBridge(): void {
  window.__loadMaxBridge?.()
}

let initialized = false

/** ready/expand/disableClosingConfirmation — ровно один раз за жизнь страницы, когда bridge готов. */
export function initWebAppOnce(): boolean {
  if (initialized) return true
  const app = getWebApp()
  if (!app) return false
  initialized = true
  try {
    app.ready()
  } catch {
    /* noop */
  }
  try {
    app.expand?.()
  } catch {
    /* noop */
  }
  try {
    // Без closing confirmation: зависшее подтверждение ломало повторный запуск в MAX.
    app.disableClosingConfirmation?.()
  } catch {
    /* noop */
  }
  return true
}

export function getWebApp(): MaxWebApp | null {
  return typeof window !== 'undefined' && window.WebApp ? window.WebApp : null
}

/** Подписанные стартовые данные. initDataUnsafe не использовать для авторизации. */
export function getInitData(): string {
  const fromBridge = getWebApp()?.initData?.trim() ?? ''
  if (fromBridge) return fromBridge
  // Резерв по документации MAX: стартовые данные есть во фрагменте URL (#WebAppData=...).
  try {
    if (typeof window === 'undefined') return ''
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const query = new URLSearchParams(window.location.search)
    for (const params of [hash, query]) {
      for (const key of ['WebAppData', 'tgWebAppData']) {
        const v = params.get(key)?.trim()
        if (v) return v
      }
    }
    return ''
  } catch {
    return ''
  }
}

export function isInsideMax(): boolean {
  return getInitData().length > 0
}

/**
 * Возврат в диалог: документированного close() нет.
 * Используем openMaxLink на бота, если задан MAX-бот username через data-атрибут / meta,
 * иначе просим закрыть окно системной кнопкой MAX.
 */
export function returnToMax(botDeepLink: string | null): 'opened' | 'manual' {
  const app = getWebApp()
  if (app?.openMaxLink && botDeepLink) {
    try {
      app.openMaxLink(botDeepLink)
      return 'opened'
    } catch {
      /* fall through */
    }
  }
  return 'manual'
}
