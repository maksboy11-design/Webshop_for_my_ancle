import type { Review, ReviewMedia } from './types'

export class ReviewsUnavailable extends Error {
  constructor() {
    super('reviews_unavailable')
    this.name = 'ReviewsUnavailable'
  }
}

function isReview(value: unknown): value is Review {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    typeof row.id === 'string' &&
    typeof row.productId === 'string' &&
    (typeof row.author === 'string' || row.author === null) &&
    (typeof row.text === 'string' || row.text === null)
  )
}

/** Только путь этого сайта: временные ссылки MAX и чужие адреса не попадают в карточку. */
function isSitePath(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')
}

function readMedia(value: unknown): ReviewMedia[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new ReviewsUnavailable()
  const media = value.map((item) => {
    if (!item || typeof item !== 'object') throw new ReviewsUnavailable()
    const row = item as Record<string, unknown>
    let type: 'image' | 'video'
    if (row.type === 'image') type = 'image'
    else if (row.type === 'video') type = 'video'
    else throw new ReviewsUnavailable()
    if (!isSitePath(row.src)) throw new ReviewsUnavailable()
    const poster = row.poster === undefined || row.poster === null ? null : row.poster
    if (poster !== null && !isSitePath(poster)) throw new ReviewsUnavailable()
    const alt = row.alt === undefined || row.alt === null ? null : row.alt
    if (alt !== null && typeof alt !== 'string') throw new ReviewsUnavailable()
    return { type, src: row.src, poster, alt }
  })
  return media.length > 0 ? media : undefined
}

/** Оставляет только публичные поля. Служебные ключи ответа не попадают в модель сайта. */
export function parsePublishedReviews(payload: unknown): Review[] {
  if (!payload || typeof payload !== 'object' || !('reviews' in payload) || !Array.isArray(payload.reviews)) {
    throw new ReviewsUnavailable()
  }
  return payload.reviews.map((item) => {
    if (!isReview(item)) throw new ReviewsUnavailable()
    const media = readMedia((item as { media?: unknown }).media)
    return media
      ? { id: item.id, productId: item.productId, author: item.author, text: item.text, media }
      : { id: item.id, productId: item.productId, author: item.author, text: item.text }
  })
}

export async function listPublishedReviews(query?: { productId?: string }): Promise<readonly Review[]> {
  const params = new URLSearchParams()
  if (query?.productId) params.set('productId', query.productId)
  const suffix = params.size > 0 ? `?${params.toString()}` : ''
  let response: Response
  try {
    response = await fetch(`/api/reviews${suffix}`, { headers: { accept: 'application/json' } })
  } catch {
    throw new ReviewsUnavailable()
  }
  if (!response.ok) throw new ReviewsUnavailable()
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new ReviewsUnavailable()
  }
  return parsePublishedReviews(payload)
}
