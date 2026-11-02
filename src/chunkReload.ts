/**
 * После деплоя старые хеши чанков исчезают, а открытая (или закешированная webview MAX) страница
 * всё ещё ссылается на них. При ошибке загрузки чанка перезагружаем страницу один раз;
 * повтор не чаще раза в RELOAD_WINDOW_MS, чтобы не уйти в цикл, если чанк действительно битый.
 */
export const CHUNK_RELOAD_KEY = 'silkway:chunk-reload-at'
export const RELOAD_WINDOW_MS = 60_000

const CHUNK_ERROR =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|Loading (CSS )?chunk .* failed/i

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return CHUNK_ERROR.test(message)
}

interface GuardStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** true — перезагрузка запущена; false — уже перезагружались недавно (показываем ошибку). */
export function reloadOnce(storage: GuardStorage | null, reload: () => void, now = Date.now()): boolean {
  try {
    const last = Number(storage?.getItem(CHUNK_RELOAD_KEY) ?? 0)
    if (Number.isFinite(last) && last > 0 && now - last < RELOAD_WINDOW_MS) return false
    storage?.setItem(CHUNK_RELOAD_KEY, String(now))
  } catch {
    // sessionStorage недоступен — всё равно одна попытка за жизнь страницы.
  }
  reload()
  return true
}

function sessionStore(): GuardStorage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

/** Источники несохранённой работы (редактор страниц и т.п.): пока хоть один «грязный», не перезагружаем. */
const unsavedGuards = new Set<() => boolean>()
export function registerUnsavedGuard(fn: () => boolean): () => void {
  unsavedGuards.add(fn)
  return () => unsavedGuards.delete(fn)
}
export function hasUnsavedWork(): boolean {
  for (const g of unsavedGuards) {
    try {
      if (g()) return true
    } catch {
      /* ignore */
    }
  }
  return false
}

let reloading = false
export function tryReloadForChunkError(error: unknown): boolean {
  if (reloading || !isChunkLoadError(error)) return reloading
  // Перезагрузка стёрла бы несохранённые правки: оставляем ошибку видимой, правки — в редакторе и localStorage.
  if (hasUnsavedWork()) return false
  reloading = reloadOnce(sessionStore(), () => window.location.reload())
  return reloading
}

export function installChunkReload(): void {
  window.addEventListener('vite:preloadError', (event) => {
    const payload = (event as Event & { payload?: unknown }).payload
    if (tryReloadForChunkError(payload ?? new Error('Failed to fetch dynamically imported module'))) event.preventDefault()
  })
  window.addEventListener('unhandledrejection', (event) => {
    if (tryReloadForChunkError(event.reason)) event.preventDefault()
  })
}
