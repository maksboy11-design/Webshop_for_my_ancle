export const MAX_ATTACHMENTS = 12
export const MAX_MEDIA_BYTES = 20 * 1024 * 1024
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

function unsupported(size: number | null = null): StoredAttachment {
  return { type: 'unsupported', token: null, photoId: null, width: null, height: null, duration: null, size }
}

function readImage(payload: Record<string, unknown>): StoredAttachment {
  const size = safeInt(payload.size, Number.MAX_SAFE_INTEGER)
  if (size != null && size > MAX_MEDIA_BYTES) return unsupported(size)
  return {
    type: 'image',
    token: tokenOf(payload.token),
    photoId: photoIdOf(payload.photo_id),
    width: null,
    height: null,
    duration: null,
    size,
  }
}

function readVideo(payload: Record<string, unknown>): StoredAttachment {
  const size = safeInt(payload.size, Number.MAX_SAFE_INTEGER)
  if (size != null && size > MAX_MEDIA_BYTES) return unsupported(size)
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
  }
}

function readOne(value: unknown): StoredAttachment {
  if (!isRecord(value) || typeof value.type !== 'string') return unsupported()
  const payload = isRecord(value.payload) ? value.payload : null
  if (value.type === 'image' && payload) return readImage(payload)
  if (value.type === 'video' && payload) return readVideo(payload)
  return unsupported()
}

/** Оставляет token и размеры. Временный url MAX в хранилище не попадает. */
export function readAttachments(value: unknown): StoredAttachment[] {
  if (!Array.isArray(value)) return []
  const stored = value.slice(0, MAX_ATTACHMENTS).map(readOne)
  if (value.length > MAX_ATTACHMENTS) stored.push(unsupported())
  return stored
}

export function attachmentsHaveDurableMedia(items: readonly StoredAttachment[]): boolean {
  return items.some((item) => (item.type === 'image' || item.type === 'video') && (item.token != null || item.photoId != null))
}
