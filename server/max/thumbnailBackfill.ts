/** Чистая логика обратной генерации миниатюр (без БД и сети) — покрыта unit-тестами. */
import { REVIEW_BLOB_HOST_SUFFIX } from './thumbnailHosts'

export interface MediaJsonItem {
  type?: unknown
  src?: unknown
  thumbnailSrc?: unknown
  [key: string]: unknown
}

/** Оригиналы фото из нашего Blob (reviews/...), у которых ещё нет миниатюры. */
export function imagesNeedingThumbnail(media: unknown): { src: string; pathname: string }[] {
  if (!Array.isArray(media)) return []
  const out: { src: string; pathname: string }[] = []
  const seen = new Set<string>()
  for (const raw of media as MediaJsonItem[]) {
    if (!raw || typeof raw !== 'object' || raw.type !== 'image') continue
    if (typeof raw.thumbnailSrc === 'string' && raw.thumbnailSrc.length > 0) continue
    if (typeof raw.src !== 'string' || seen.has(raw.src)) continue
    let url: URL
    try {
      url = new URL(raw.src)
    } catch {
      continue
    }
    const host = url.hostname.toLowerCase()
    if (url.protocol !== 'https:' || !host.endsWith(REVIEW_BLOB_HOST_SUFFIX)) continue
    const pathname = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    if (!pathname.startsWith('reviews/') || pathname.includes('..')) continue
    seen.add(raw.src)
    out.push({ src: raw.src, pathname })
  }
  return out
}

/** Возвращает новый массив медиа: добавляет thumbnailSrc только к совпавшим по src фото без миниатюры. */
export function withThumbnails(media: unknown, bySrc: ReadonlyMap<string, string>): { media: unknown[]; changed: number } {
  if (!Array.isArray(media)) return { media: [], changed: 0 }
  let changed = 0
  const next = (media as MediaJsonItem[]).map((raw) => {
    if (!raw || typeof raw !== 'object' || raw.type !== 'image' || typeof raw.src !== 'string') return raw
    if (typeof raw.thumbnailSrc === 'string' && raw.thumbnailSrc.length > 0) return raw
    const thumb = bySrc.get(raw.src)
    if (!thumb) return raw
    changed += 1
    return { ...raw, thumbnailSrc: thumb }
  })
  return { media: next, changed }
}
