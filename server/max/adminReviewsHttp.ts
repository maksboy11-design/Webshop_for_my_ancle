/**
 * Защищённый API Mini App модератора: список / детали / снятие опубликованных отзывов.
 * Авторизация — только подписанный initData MAX + MAX_REVIEW_MODERATOR_IDS.
 * user_id из тела запроса не принимается.
 *
 * Маршруты (один бандл api/admin/reviews.js):
 *   GET    /api/admin/reviews              — список (q, photos, videos, limit, offset)
 *   GET    /api/admin/reviews?id=<uuid>    — детали
 *   DELETE /api/admin/reviews?id=<uuid>    — withdraw
 *   PATCH  /api/admin/reviews?id=<uuid>    — правка (text, author, productId, removeMedia[])
 *   GET    /api/admin/reviews?catalog=1    — список товаров для выбора
 * Также принимается путь /api/admin/reviews/<uuid> (через rewrite).
 */
import { reviewId } from './text'
import { jsonResponse, readLimitedJson } from './http'
import type { Log } from './logger'
import type { ReviewStore } from './store'
import { catalogOptions, parseAdminReviewListParams, parseReviewEditBody, toDetail, toListCard } from './publishedReviewSearch'
import { authorizeAdmin } from './adminAuth'

export interface AdminReviewsDeps {
  store: ReviewStore | null
  log: Log
  botToken: string | null
  moderators: ReadonlySet<string>
  moderatorsConfigured: boolean
  now: () => Date
}

function extractReviewId(url: URL): string | null {
  const fromQuery = url.searchParams.get('id')
  if (fromQuery) return reviewId(fromQuery)
  const parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean)
  // api / admin / reviews / :id
  if (parts.length >= 4 && parts[0] === 'api' && parts[1] === 'admin' && parts[2] === 'reviews') {
    return reviewId(parts[3] ?? null)
  }
  return null
}

export async function handleAdminReviewsRequest(request: Request, deps: AdminReviewsDeps): Promise<Response> {
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return jsonResponse(400, { error: 'bad_request' })
  }

  const auth = authorizeAdmin(request, deps)
  if (!auth.ok) return jsonResponse(auth.status, { error: auth.error })
  if (!deps.store) return jsonResponse(503, { error: 'unavailable' })

  const id = extractReviewId(url)

  try {
    if (request.method === 'GET' && !id && url.searchParams.get('catalog') === '1') {
      return jsonResponse(200, { products: catalogOptions() })
    }

    if (request.method === 'GET' && !id) {
      const parsed = parseAdminReviewListParams(url)
      if (!parsed.ok) return jsonResponse(400, { error: parsed.error })
      const result = await deps.store.transaction((tx) => tx.searchPublishedReviews(parsed.query))
      return jsonResponse(200, {
        total: result.total,
        reviews: result.items.map(toListCard),
      })
    }

    if (id) {
      if (request.method === 'GET') {
        const item = await deps.store.transaction((tx) => tx.getPublishedReview(id))
        if (!item) return jsonResponse(404, { error: 'not_found' })
        return jsonResponse(200, { review: toDetail(item) })
      }
      if (request.method === 'DELETE') {
        const atIso = deps.now().toISOString()
        const result = await deps.store.transaction((tx) => tx.withdrawReview(id, auth.userId, atIso))
        if (result === 'withdrawn') return jsonResponse(200, { ok: true, status: 'withdrawn' })
        if (result === 'not_published') return jsonResponse(409, { error: 'already_withdrawn' })
        return jsonResponse(404, { error: 'not_found' })
      }
      if (request.method === 'PATCH') {
        const body = await readLimitedJson(request)
        if (!body.ok) return jsonResponse(body.status, { error: 'bad_request' })
        const parsed = parseReviewEditBody(body.value)
        if (!parsed.ok) return jsonResponse(400, { error: parsed.error })
        const patch = parsed.patch
        const outcome = await deps.store.transaction(async (tx) => {
          const edited = await tx.editPublishedReview(id, patch)
          if (edited.result !== 'updated') return { edited, item: null }
          return { edited, item: await tx.getPublishedReview(id) }
        })
        if (outcome.edited.result === 'missing') return jsonResponse(404, { error: 'not_found' })
        if (outcome.edited.result === 'not_published') return jsonResponse(409, { error: 'already_withdrawn' })
        const fields = [
          patch.text !== undefined ? 'text' : null,
          patch.author !== undefined ? 'author' : null,
          patch.productId !== undefined ? 'product' : null,
          patch.removeMediaSrc ? `media-${outcome.edited.removedMedia}` : null,
        ].filter(Boolean).join(',')
        // Аудит без текста и персональных данных: только список изменённых полей.
        deps.log.info('admin_review_edited', { kind: fields })
        if (!outcome.item) return jsonResponse(404, { error: 'not_found' })
        return jsonResponse(200, { review: toDetail(outcome.item) })
      }
      return jsonResponse(405, { error: 'method_not_allowed' }, { allow: 'GET, DELETE, PATCH' })
    }

    return jsonResponse(405, { error: 'method_not_allowed' }, { allow: 'GET, DELETE, PATCH' })
  } catch {
    deps.log.error('storage_failed')
    return jsonResponse(503, { error: 'unavailable' })
  }
}
