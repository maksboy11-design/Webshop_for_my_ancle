import { isAllowedMaxMediaUrl } from './mediaHosts'

export const MAX_ATTACHMENTS = 12
/** Лимит фото из группы (MAX до 50 МБ; держим ближе к медиатеке). */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024
/** Лимит видео из группы (MAX до 250 МБ). Раньше общий 20 МБ отбрасывал типичные ролики с телефона как unsupported. */
export const MAX_VIDEO_BYTES = 250 * 1024 * 1024
/** @deprecated Используйте MAX_IMAGE_BYTES / MAX_VIDEO_BYTES. Оставлен как верхняя граница скачивания. */
export const MAX_MEDIA_BYTES = MAX_VIDEO_BYTES
const TOKEN_MAX = 512

function hasControl(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

export interface StoredAttachment {
  type: 'image' | 'video' | 'unsupported'
  token: string | null
  photoId: string | null
  width: number | null
  height: number | null
  duration: number | null
  size: number | null
  /** Временный URL MAX из webhook/GET. В БД не пишется; только для скачивания в том же запросе. */
  sourceUrl: string | null
  /** Постоянный публичный URL после загрузки в хранилище. */
  persistedSrc: string | null
  /** Необязательная WebP-миниатюра фото в хранилище (для списка Mini App). Старые записи без поля. */
  thumbnailSrc?: string | null
}

export interface PublicReviewMedia {
  type: 'image' | 'video'
  src: string
  poster: string | null
  alt: string | null
  /** Необязательная миниатюра для списков; src остаётся оригиналом. */
  thumbnailSrc?: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function tokenOf(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > TOKEN_MAX) return null
  if (hasControl(trimmed)) return null
  return trimmed
}

function safeInt(value: unknown, max: number): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) return null
  return value
}

function photoIdOf(value: unknown): string | null {
  const id = safeInt(value, Number.MAX_SAFE_INTEGER)
  if (id == null || id <= 0) return null
  return String(id)
}

function dimension(value: unknown): number | null {
  const parsed = safeInt(value, 20_000)
  if (parsed == null || parsed <= 0) return null
  return parsed
}

function sourceUrlOf(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 2048) return null
  if (hasControl(trimmed)) return null
  if (!isAllowedMaxMediaUrl(trimmed)) return null
  return trimmed
}

function unsupported(size: number | null = null): StoredAttachment {
  return {
    type: 'unsupported',
    token: null,
    photoId: null,
    width: null,
    height: null,
    duration: null,
    size,
    sourceUrl: null,
    persistedSrc: null,
  }
}

function readImage(payload: Record<string, unknown>): StoredAttachment {
  const size = safeInt(payload.size, Number.MAX_SAFE_INTEGER)
  if (size != null && size > MAX_IMAGE_BYTES) return unsupported(size)
  return {
    type: 'image',
    token: tokenOf(payload.token),
    photoId: photoIdOf(payload.photo_id),
    width: null,
    height: null,
    duration: null,
    size,
    sourceUrl: sourceUrlOf(payload.url),
    persistedSrc: null,
  }
}

function readVideo(payload: Record<string, unknown>): StoredAttachment {
  const size = safeInt(payload.size, Number.MAX_SAFE_INTEGER)
  if (size != null && size > MAX_VIDEO_BYTES) return unsupported(size)
  const duration = safeInt(payload.duration, 60 * 60)
  if (payload.duration != null && duration == null) return unsupported(size)
  return {
    type: 'video',
    token: tokenOf(payload.token),
    photoId: null,
    width: dimension(payload.width),
    height: dimension(payload.height),
    duration,
    size,
    sourceUrl: sourceUrlOf(payload.url),
    persistedSrc: null,
  }
}

function readOne(value: unknown): StoredAttachment {
  if (!isRecord(value) || typeof value.type !== 'string') return unsupported()
  const payload = isRecord(value.payload) ? value.payload : null
  if (value.type === 'image' && payload) return readImage(payload)
  if (value.type === 'video' && payload) return readVideo(payload)
  return unsupported()
}

/** Оставляет token, размеры и постоянный URL. Временный url MAX в хранилище не попадает. */
export function readAttachments(value: unknown): StoredAttachment[] {
  if (!Array.isArray(value)) return []
  const stored = value.slice(0, MAX_ATTACHMENTS).map(readOne)
  if (value.length > MAX_ATTACHMENTS) stored.push(unsupported())
  return stored
}

export function attachmentsForStorage(items: readonly StoredAttachment[]): StoredAttachment[] {
  return items.map((item) => ({ ...item, sourceUrl: null }))
}

export function attachmentsHaveDurableMedia(items: readonly StoredAttachment[]): boolean {
  return items.some((item) => (item.type === 'image' || item.type === 'video') && item.persistedSrc != null)
}

export function attachmentsNeedPersist(items: readonly StoredAttachment[]): boolean {
  return items.some((item) => {
    if ((item.type !== 'image' && item.type !== 'video') || item.persistedSrc != null) return false
    // Фото: нужен временный url. Видео: url из webhook или token → GET /videos/{token}.
    if (item.sourceUrl != null) return true
    return item.type === 'video' && item.token != null
  })
}

export function publicMediaOf(items: readonly StoredAttachment[]): PublicReviewMedia[] {
  const media: PublicReviewMedia[] = []
  for (const item of items) {
    if ((item.type !== 'image' && item.type !== 'video') || !item.persistedSrc) continue
    media.push({
      type: item.type,
      src: item.persistedSrc,
      poster: null,
      alt: null,
      ...(item.type === 'image' && item.thumbnailSrc ? { thumbnailSrc: item.thumbnailSrc } : {}),
    })
  }
  return media
}

export function mergeSourceUrls(current: readonly StoredAttachment[], fresh: readonly StoredAttachment[]): StoredAttachment[] {
  return current.map((item, index) => {
    if (item.persistedSrc || item.sourceUrl) return item
    const next = fresh[index]
    if (!next || next.type !== item.type) return item
    if (!next.sourceUrl) return item
    return { ...item, sourceUrl: next.sourceUrl }
  })
}
