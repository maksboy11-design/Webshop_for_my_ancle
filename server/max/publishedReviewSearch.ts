/**
 * Поиск и фильтры опубликованных отзывов для Mini App модератора.
 * SQL параметризован; ключевые слова нормализуются; спецсимволы ILIKE экранируются.
 */
import { PRODUCTS } from '../../src/data/products'
import { findProduct } from './catalog'
import { authorName, reviewText } from './text'
import { isAllowedPublicMediaSrc } from './mediaHosts'
import type { PublicReviewMedia } from './attachments'

export const ADMIN_REVIEW_PAGE_MAX = 50
export const ADMIN_REVIEW_PAGE_DEFAULT = 20
export const TEXT_PREVIEW_MAX = 150
/** Верхняя граница точного фильтра медиа (защита от мусора в query). */
export const MEDIA_FILTER_MAX = 100

export interface PublishedReviewSearchQuery {
  q: string
  photos: number | null
  videos: number | null
  limit: number
  offset: number
}

export interface PublishedReviewAdminItem {
  id: string
  productId: string
  productName: string
  author: string | null
  text: string
  textPreview: string
  photosCount: number
  videosCount: number
  mediaCount: number
  media: PublicReviewMedia[]
  publishedAt: string | null
}

export function normalizeSearchQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

/** Значимые слова запроса (без пустых). Поиск без учёта регистра. */
export function searchWords(q: string): string[] {
  const normalized = normalizeSearchQuery(q).toLowerCase()
  if (!normalized) return []
  return normalized.split(' ').filter((w) => w.length > 0)
}

/** Экранирует % _ \ для ILIKE. */
export function escapeIlike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

export function productIdsMatchingWord(word: string): string[] {
  const needle = word.toLowerCase()
  return PRODUCTS.filter((p) => p.name.toLowerCase().includes(needle)).map((p) => p.id)
}

export function previewText(text: string, limit = TEXT_PREVIEW_MAX): string {
  const chars = Array.from(text)
  if (chars.length <= limit) return text
  return `${chars.slice(0, limit).join('')}…`
}

export function countMediaByType(media: readonly PublicReviewMedia[]): {
  photosCount: number
  videosCount: number
  mediaCount: number
  safeMedia: PublicReviewMedia[]
} {
  const safeMedia: PublicReviewMedia[] = []
  let photosCount = 0
  let videosCount = 0
  for (const item of media) {
    if (!isAllowedPublicMediaSrc(item.src)) continue
    if (item.poster != null && !isAllowedPublicMediaSrc(item.poster)) {
      if (item.type === 'image') continue
      safeMedia.push({ type: item.type, src: item.src, poster: null, alt: item.alt })
    } else {
      safeMedia.push(item)
    }
    if (item.type === 'image') photosCount += 1
    else if (item.type === 'video') videosCount += 1
  }
  return { photosCount, videosCount, mediaCount: photosCount + videosCount, safeMedia }
}

export function matchesSearchCorpus(input: {
  text: string
  author: string | null
  productId: string
  words: string[]
}): boolean {
  if (input.words.length === 0) return true
  const productName = findProduct(input.productId)?.name ?? input.productId
  const corpus = `${input.text} ${input.author ?? ''} ${productName}`.toLowerCase()
  return input.words.every((w) => corpus.includes(w))
}

export function toAdminItem(row: {
  id: string
  productId: string
  author: string | null
  text: string
  media: PublicReviewMedia[]
  publishedAt: string | null
}): PublishedReviewAdminItem {
  const { photosCount, videosCount, mediaCount, safeMedia } = countMediaByType(row.media)
  const product = findProduct(row.productId)
  return {
    id: row.id,
    productId: row.productId,
    productName: product?.name ?? row.productId,
    author: row.author,
    text: row.text,
    textPreview: previewText(row.text),
    photosCount,
    videosCount,
    mediaCount,
    media: safeMedia,
    publishedAt: row.publishedAt,
  }
}

export type ParseListParamsResult =
  | { ok: true; query: PublishedReviewSearchQuery }
  | { ok: false; error: string }

function parseOptionalExactCount(raw: string | null, label: string): { ok: true; value: number | null } | { ok: false; error: string } {
  if (raw == null || raw === '') return { ok: true, value: null }
  if (!/^\d{1,3}$/.test(raw)) return { ok: false, error: `invalid_${label}` }
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0 || n > MEDIA_FILTER_MAX) return { ok: false, error: `invalid_${label}` }
  return { ok: true, value: n }
}

export function parseAdminReviewListParams(url: URL): ParseListParamsResult {
  const q = normalizeSearchQuery(url.searchParams.get('q') ?? '')
  const photos = parseOptionalExactCount(url.searchParams.get('photos'), 'photos')
  if (!photos.ok) return photos
  const videos = parseOptionalExactCount(url.searchParams.get('videos'), 'videos')
  if (!videos.ok) return videos
  const limitRaw = url.searchParams.get('limit')
  let limit = ADMIN_REVIEW_PAGE_DEFAULT
  if (limitRaw != null && limitRaw !== '') {
    if (!/^\d{1,3}$/.test(limitRaw)) return { ok: false, error: 'invalid_limit' }
    limit = Number(limitRaw)
    if (!Number.isInteger(limit) || limit < 1 || limit > ADMIN_REVIEW_PAGE_MAX) {
      return { ok: false, error: 'invalid_limit' }
    }
  }
  const offsetRaw = url.searchParams.get('offset')
  let offset = 0
  if (offsetRaw != null && offsetRaw !== '') {
    if (!/^\d{1,6}$/.test(offsetRaw)) return { ok: false, error: 'invalid_offset' }
    offset = Number(offsetRaw)
    if (!Number.isInteger(offset) || offset < 0) return { ok: false, error: 'invalid_offset' }
  }
  return { ok: true, query: { q, photos: photos.value, videos: videos.value, limit, offset } }
}

/** Карточка списка без полного текста (textPreview достаточно; text оставляем для тестов/совместимости укороченным). */
export function toListCard(item: PublishedReviewAdminItem) {
  return {
    id: item.id,
    productId: item.productId,
    productName: item.productName,
    author: item.author,
    textPreview: item.textPreview,
    photosCount: item.photosCount,
    videosCount: item.videosCount,
    mediaCount: item.mediaCount,
    media: item.media.slice(0, 4),
    publishedAt: item.publishedAt,
  }
}

export function toDetail(item: PublishedReviewAdminItem) {
  return {
    id: item.id,
    productId: item.productId,
    productName: item.productName,
    author: item.author,
    text: item.text,
    photosCount: item.photosCount,
    videosCount: item.videosCount,
    mediaCount: item.mediaCount,
    media: item.media,
    publishedAt: item.publishedAt,
  }
}

export const EDIT_REMOVE_MEDIA_MAX = 50

export type ParseEditResult =
  | { ok: true; patch: import('./store').ReviewEditPatch }
  | { ok: false; error: string }

/** Валидация тела PATCH: те же лимиты, что при приёме отзыва (REVIEW_TEXT_MAX / AUTHOR_MAX). */
export function parseReviewEditBody(value: unknown): ParseEditResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'bad_request' }
  const body = value as Record<string, unknown>
  const patch: import('./store').ReviewEditPatch = {}
  if ('text' in body) {
    if (typeof body.text !== 'string') return { ok: false, error: 'invalid_text' }
    const checked = reviewText(body.text)
    if (!checked.ok) return { ok: false, error: checked.reason === 'empty' ? 'empty_text' : checked.reason === 'too_long' ? 'text_too_long' : 'invalid_text' }
    patch.text = checked.text
  }
  if ('author' in body) {
    if (body.author === null || (typeof body.author === 'string' && body.author.trim() === '')) {
      patch.author = null
    } else if (typeof body.author === 'string') {
      const checked = authorName(body.author)
      if (!checked.ok) return { ok: false, error: checked.reason === 'too_long' ? 'author_too_long' : 'invalid_author' }
      patch.author = checked.text
    } else {
      return { ok: false, error: 'invalid_author' }
    }
  }
  if ('productId' in body) {
    if (typeof body.productId !== 'string' || !findProduct(body.productId)) return { ok: false, error: 'unknown_product' }
    patch.productId = body.productId
  }
  if ('removeMedia' in body) {
    const list = body.removeMedia
    if (!Array.isArray(list) || list.length > EDIT_REMOVE_MEDIA_MAX) return { ok: false, error: 'invalid_media' }
    const srcs: string[] = []
    for (const item of list) {
      if (typeof item !== 'string' || item.length === 0 || item.length > 2048) return { ok: false, error: 'invalid_media' }
      srcs.push(item)
    }
    if (srcs.length > 0) patch.removeMediaSrc = [...new Set(srcs)]
  }
  if (patch.text === undefined && patch.author === undefined && patch.productId === undefined && !patch.removeMediaSrc) {
    return { ok: false, error: 'empty_patch' }
  }
  return { ok: true, patch }
}

/** Каталог для выбора товара в Mini App (только id и название). */
export function catalogOptions(): { id: string; name: string }[] {
  return PRODUCTS.map((p) => ({ id: p.id, name: p.name }))
}
