/**
 * Импорт вебинаров из YouTube-ссылок (режим A: официальный embed youtube-nocookie).
 * Видео не скачивается и не перекодируется. Метаданные — только через YouTube Data API v3 (videos.list).
 * Ключ API никогда не логируется и не возвращается наружу.
 */

export const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/
export const WEBINAR_TITLE_MAX = 200
export const WEBINAR_SPEAKER_MAX = 120
const START_MAX = 86_400

const WATCH_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com'])
const SHORT_HOST = 'youtu.be'

export interface YoutubeRef {
  videoId: string
  startSeconds: number | null
}

/** «90», «90s», «1h2m3s», «2m» → секунды. Иначе null. */
export function parseStartTime(value: string | null): number | null {
  if (value == null) return null
  const raw = value.trim().toLowerCase()
  if (raw.length === 0 || raw.length > 12) return null
  let seconds: number
  if (/^\d+$/.test(raw)) {
    seconds = Number(raw)
  } else {
    const match = /^(?:(\d{1,2})h)?(?:(\d{1,3})m)?(?:(\d{1,5})s)?$/.exec(raw)
    if (!match || (!match[1] && !match[2] && !match[3])) return null
    seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0)
  }
  if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds > START_MAX) return null
  return seconds
}

/**
 * Разбирает ссылку YouTube. Поддерживаются только точные хосты и пути:
 * youtube.com/watch?v=ID, youtu.be/ID, youtube.com/shorts/ID, youtube.com/live/ID.
 * Любой другой хост (в том числе поддомены-обманки), userinfo, нестандартный порт, embed-URL — отказ.
 */
export function parseYoutubeUrl(input: string): YoutubeRef | null {
  if (typeof input !== 'string' || input.length > 2048) return null
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username || url.password || url.port) return null
  const host = url.hostname.toLowerCase()
  const segments = url.pathname.split('/').filter((part) => part.length > 0)
  let videoId: string | null = null
  if (host === SHORT_HOST) {
    if (segments.length === 1) videoId = segments[0] ?? null
  } else if (WATCH_HOSTS.has(host)) {
    if (segments.length === 1 && segments[0] === 'watch') {
      const values = url.searchParams.getAll('v')
      if (values.length === 1) videoId = values[0] ?? null
    } else if (segments.length === 2 && (segments[0] === 'shorts' || segments[0] === 'live')) {
      videoId = segments[1] ?? null
    }
  }
  if (!videoId || !YOUTUBE_ID.test(videoId)) return null
  const start = parseStartTime(url.searchParams.get('t') ?? url.searchParams.get('start'))
  return { videoId, startSeconds: start }
}

const URL_CANDIDATE = /https?:\/\/[^\s<>"'«»()[\]{}]+/giu

/** Первая валидная YouTube-ссылка в тексте; invalid — нашлась ссылка, похожая на YouTube, но не прошедшая проверку. */
export function findYoutubeLink(text: string | null): { ref: YoutubeRef | null; invalid: boolean } {
  if (!text) return { ref: null, invalid: false }
  let invalid = false
  for (const match of text.matchAll(URL_CANDIDATE)) {
    const candidate = match[0].replace(/[.,;:!?…]+$/u, '')
    const ref = parseYoutubeUrl(candidate)
    if (ref) return { ref, invalid: false }
    if (/youtu/iu.test(candidate)) invalid = true
  }
  return { ref: null, invalid }
}

export function watchUrl(videoId: string, startSeconds: number | null = null): string {
  const base = `https://www.youtube.com/watch?v=${videoId}`
  return startSeconds ? `${base}&t=${startSeconds}s` : base
}

/* ---------- Поля сообщения «Вебинар» ---------- */

export interface WebinarFields {
  title: string | null
  speaker: string | null
  /** YYYY-MM-DD */
  date: string | null
  dateInvalid: boolean
  ref: YoutubeRef | null
  linkInvalid: boolean
}

// eslint-disable-next-line no-control-regex -- намеренно вырезаем управляющие символы из полей вебинара
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu

function clean(value: string, max: number): string | null {
  const text = value.replace(CONTROL, '').replace(/\s+/gu, ' ').trim()
  if (text.length === 0) return null
  return Array.from(text).slice(0, max).join('')
}

/** «2026-11-05», «05.11.2026», «5.11.2026» → «2026-11-05». Только реальные даты. */
export function parseWebinarDate(value: string): string | null {
  const raw = value.trim()
  let year: number
  let month: number
  let day: number
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (match) {
    year = Number(match[1])
    month = Number(match[2])
    day = Number(match[3])
  } else {
    match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(raw)
    if (!match) return null
    day = Number(match[1])
    month = Number(match[2])
    year = Number(match[3])
  }
  if (year < 2000 || year > 2100) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return date.toISOString().slice(0, 10)
}

const FIELD = /^\s*(название|тема|спикер|ведущий|дата)\s*[:：]\s*(.*)$/iu

/**
 * Разбирает текст после маркера «Вебинар».
 * Первая непустая строка без поля и без ссылки — название (если нет строки «Название:»).
 * «Спикер:» и «Дата:» — необязательные строки. Явные значения важнее метаданных YouTube.
 */
export function parseWebinarFields(publicText: string | null): WebinarFields {
  const text = publicText ?? ''
  const link = findYoutubeLink(text)
  let title: string | null = null
  let freeTitle: string | null = null
  let speaker: string | null = null
  let date: string | null = null
  let dateInvalid = false
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (line.length === 0) continue
    const field = FIELD.exec(line)
    if (field) {
      const name = (field[1] ?? '').toLowerCase()
      const value = field[2] ?? ''
      if (name === 'название' || name === 'тема') title = clean(value, WEBINAR_TITLE_MAX) ?? title
      else if (name === 'спикер' || name === 'ведущий') speaker = clean(value, WEBINAR_SPEAKER_MAX) ?? speaker
      else {
        const parsed = parseWebinarDate(value)
        if (parsed) date = parsed
        else if (value.trim()) dateInvalid = true
      }
      continue
    }
    if (freeTitle == null) {
      const withoutLinks = line.replace(URL_CANDIDATE, '').trim()
      if (withoutLinks.length > 0) freeTitle = clean(withoutLinks, WEBINAR_TITLE_MAX)
    }
  }
  return { title: title ?? freeTitle, speaker, date, dateInvalid, ref: link.ref, linkInvalid: !link.ref && link.invalid }
}

/* ---------- YouTube Data API v3 ---------- */

export type MetadataStatus = 'ok' | 'not_configured' | 'not_found' | 'not_public' | 'not_embeddable' | 'api_error'

export interface YoutubeMetadata {
  status: MetadataStatus
  title: string | null
  publishedAt: string | null
}

export type YoutubeFetch = (url: string, init: { signal: AbortSignal; redirect: 'error'; headers: Record<string, string> }) => Promise<{
  ok: boolean
  status: number
  json(): Promise<unknown>
}>

export interface YoutubeMetadataDeps {
  apiKey: string | null
  fetch?: YoutubeFetch
  timeoutMs?: number
}

const API = 'https://www.googleapis.com/youtube/v3/videos'

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Разбор ответа videos.list. Отдельно, чтобы тестировать без сети. */
export function metadataFromResponse(body: unknown): YoutubeMetadata {
  const items = body && typeof body === 'object' ? (body as { items?: unknown }).items : null
  if (!Array.isArray(items) || items.length === 0) return { status: 'not_found', title: null, publishedAt: null }
  const item = items[0] as Record<string, unknown>
  const snippet = (item.snippet ?? {}) as Record<string, unknown>
  const status = (item.status ?? {}) as Record<string, unknown>
  const live = (item.liveStreamingDetails ?? {}) as Record<string, unknown>
  const title = str(snippet.title)
  const cleanedTitle = title ? clean(title, WEBINAR_TITLE_MAX) : null
  const publishedRaw = str(live.actualStartTime) ?? str(live.scheduledStartTime) ?? str(snippet.publishedAt)
  const publishedAt = publishedRaw && !Number.isNaN(Date.parse(publishedRaw)) ? new Date(publishedRaw).toISOString() : null
  const privacy = str(status.privacyStatus)
  const upload = str(status.uploadStatus)
  let result: MetadataStatus = 'ok'
  if (privacy === 'private' || (upload && upload !== 'processed' && upload !== 'uploaded')) result = 'not_public'
  else if (status.embeddable === false) result = 'not_embeddable'
  return { status: result, title: cleanedTitle, publishedAt }
}

export async function fetchYoutubeMetadata(videoId: string, deps: YoutubeMetadataDeps): Promise<YoutubeMetadata> {
  const empty = (status: MetadataStatus): YoutubeMetadata => ({ status, title: null, publishedAt: null })
  if (!YOUTUBE_ID.test(videoId)) return empty('not_found')
  const key = deps.apiKey?.trim()
  if (!key) return empty('not_configured')
  const doFetch: YoutubeFetch = deps.fetch ?? ((url, init) => fetch(url, init))
  const url = `${API}?part=snippet,status,liveStreamingDetails&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(key)}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 5_000)
  try {
    const response = await doFetch(url, { signal: controller.signal, redirect: 'error', headers: { accept: 'application/json' } })
    if (!response.ok) return empty('api_error')
    return metadataFromResponse(await response.json())
  } catch {
    // Текст ошибки может содержать URL с ключом: наружу отдаём только статус.
    return empty('api_error')
  } finally {
    clearTimeout(timer)
  }
}

export function metadataStatusText(status: MetadataStatus | 'hosted'): string {
  switch (status) {
    case 'ok':
      return 'YouTube: видео доступно, встраивание разрешено.'
    case 'not_configured':
      return 'YouTube API не настроен (нет YOUTUBE_API_KEY): проверьте ссылку, название и доступность видео вручную.'
    case 'not_found':
      return 'YouTube: видео не найдено или удалено. Публикация заблокирована.'
    case 'not_public':
      return 'YouTube: видео приватное или ещё не обработано. Публикация заблокирована.'
    case 'not_embeddable':
      return 'YouTube: владелец запретил встраивание. На сайте будет только ссылка «Смотреть на YouTube».'
    case 'api_error':
      return 'YouTube API временно недоступен: проверьте видео вручную или нажмите «Проверить YouTube».'
    case 'hosted':
      return 'Запись размещена в хранилище сайта (режим B).'
  }
}

/** Статусы, при которых публиковать нельзя: ссылка заведомо не работает. */
export function blocksPublication(status: string): boolean {
  return status === 'not_found' || status === 'not_public'
}
