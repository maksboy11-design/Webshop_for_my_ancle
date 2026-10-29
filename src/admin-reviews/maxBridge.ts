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

declare global {
  interface Window {
    WebApp?: MaxWebApp
  }
}

export function getWebApp(): MaxWebApp | null {
  return typeof window !== 'undefined' && window.WebApp ? window.WebApp : null
}

/** Подписанные стартовые данные. initDataUnsafe не использовать для авторизации. */
export function getInitData(): string {
  return getWebApp()?.initData?.trim() ?? ''
}

export function isInsideMax(): boolean {
  const app = getWebApp()
  return Boolean(app && typeof app.initData === 'string' && app.initData.length > 0)
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
