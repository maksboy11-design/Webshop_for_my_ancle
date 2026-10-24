import { findProduct } from './catalog'
import { jsonResponse } from './http'
import type { Log } from './logger'
import type { ReviewStore } from './store'

export async function handleReviewsRequest(
  request: Request,
  deps: { store: ReviewStore | null; log: Log },
): Promise<Response> {
  if (request.method !== 'GET') return jsonResponse(405, { error: 'method_not_allowed' }, { allow: 'GET' })
  if (!deps.store) return jsonResponse(503, { error: 'unavailable' })
  let productId: string | null
  try {
    productId = new URL(request.url).searchParams.get('productId')
  } catch {
    return jsonResponse(400, { error: 'bad_request' })
  }
  if (productId !== null && !findProduct(productId)) return jsonResponse(400, { error: 'unknown_product' })
  try {
    const reviews = await deps.store.listPublished(productId)
    return jsonResponse(200, {
      reviews: reviews.map((review) => ({
        id: review.id,
        productId: review.productId,
        author: review.author,
        text: review.text,
        media: review.media,
      })),
    })
  } catch {
    deps.log.error('storage_failed')
    return jsonResponse(503, { error: 'unavailable' })
  }
}
