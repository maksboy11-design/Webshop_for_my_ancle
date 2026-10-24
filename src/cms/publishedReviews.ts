import type { Review } from './types'

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

/** Оставляет только публичные поля. Служебные ключи ответа не попадают в модель сайта. */
export function parsePublishedReviews(payload: unknown): Review[] {
  if (!payload || typeof payload !== 'object' || !('reviews' in payload) || !Array.isArray(payload.reviews)) {
    throw new ReviewsUnavailable()
  }
  return payload.reviews.map((item) => {
    if (!isReview(item)) throw new ReviewsUnavailable()
    return { id: item.id, productId: item.productId, author: item.author, text: item.text }
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
