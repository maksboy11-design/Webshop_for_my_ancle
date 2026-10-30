/**
 * Ограниченные повторы только для безопасных GET.
 * POST/PATCH/DELETE сюда не передавать — риск дублей.
 */
export type FetchRetryOptions = {
  /** Сколько попыток всего (включая первую). По умолчанию 3. */
  attempts?: number
  /** Базовая задержка ms перед 2-й попыткой. Дальше ×2. */
  baseDelayMs?: number
  /** Таймаут одной попытки. */
  timeoutMs?: number
  signal?: AbortSignal
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}

function jitter(ms: number): number {
  return Math.round(ms * (0.75 + Math.random() * 0.5))
}

export async function fetchGetWithRetry(
  input: string,
  init: RequestInit = {},
  options: FetchRetryOptions = {},
): Promise<Response> {
  const attempts = options.attempts ?? 3
  const baseDelayMs = options.baseDelayMs ?? 400
  const timeoutMs = options.timeoutMs ?? 12_000
  let lastError: unknown

  for (let i = 0; i < attempts; i++) {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    options.signal?.addEventListener('abort', onAbort)
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(input, {
        ...init,
        method: 'GET',
        signal: controller.signal,
      })
      // Повторяем только сетевые сбои и 5xx/429; 4xx — сразу.
      if (response.ok || (response.status < 500 && response.status !== 429)) return response
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
      if (options.signal?.aborted) throw error
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
    }
    if (i < attempts - 1) await sleep(jitter(baseDelayMs * 2 ** i), options.signal)
  }
  throw lastError instanceof Error ? lastError : new Error('fetch_failed')
}
