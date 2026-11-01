import { findProduct } from './catalog'
import { jsonResponse } from './http'
import type { Log } from './logger'
import type { ReviewStore } from './store'
import { publicReviewFromEntry, type EntryStore } from './cmsEntries'

export async function handleReviewsRequest(
  request: Request,
  deps: { store: ReviewStore | null; log: Log; entries?: EntryStore | null },
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
    if (deps.entries) {
      try {
        const manual = (await deps.entries.list('review', 'published')).map(publicReviewFromEntry)
        for (const r of manual) if (r && (productId === null || r.productId === productId)) reviews.push(r)
      } catch {
        deps.log.error('review_entries_unavailable')
      }
    }
    return jsonResponse(
      200,
      {
        reviews: reviews.map((review) => ({
          id: review.id,
          productId: review.productId,
          author: review.author,
          text: review.text,
          media: review.media,
        })),
      },
      { 'cache-control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' },
    )
  } catch {
    deps.log.error('storage_failed')
    return jsonResponse(503, { error: 'unavailable' })
  }
}
