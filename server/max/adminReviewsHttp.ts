/**
 * Защищённый API Mini App модератора: список / детали / снятие опубликованных отзывов.
 * Авторизация — только подписанный initData MAX + MAX_REVIEW_MODERATOR_IDS.
 * user_id из тела запроса не принимается.
 *
 * Маршруты (один бандл api/admin/reviews.js):
 *   GET    /api/admin/reviews              — список (q, photos, videos, limit, offset)
 *   GET    /api/admin/reviews?id=<uuid>    — детали
 *   DELETE /api/admin/reviews?id=<uuid>    — withdraw
 * Также принимается путь /api/admin/reviews/<uuid> (через rewrite).
 */
import { reviewId } from './text'
import { jsonResponse } from './http'
import type { Log } from './logger'
import type { ReviewStore } from './store'
import { parseAdminReviewListParams, toDetail, toListCard } from './publishedReviewSearch'
import { validateWebAppInitData } from './webAppInitData'

export interface AdminReviewsDeps {
  store: ReviewStore | null
  log: Log
  botToken: string | null
  moderators: ReadonlySet<string>
  moderatorsConfigured: boolean
  now: () => Date
}

function readInitData(request: Request): string | null {
  const header = request.headers.get('x-max-init-data')
  if (header && header.trim()) return header.trim()
  const auth = request.headers.get('authorization')
  if (auth) {
    const m = /^tma\s+(.+)$/i.exec(auth.trim())
    if (m?.[1]) return m[1].trim()
  }
  return null
}

function authorize(request: Request, deps: AdminReviewsDeps):
  | { ok: true; userId: string }
  | { ok: false; status: number; error: string } {
  if (!deps.botToken) return { ok: false, status: 503, error: 'bot_not_configured' }
  if (!deps.moderatorsConfigured) return { ok: false, status: 503, error: 'moderators_not_configured' }
  const initData = readInitData(request)
  if (!initData) return { ok: false, status: 401, error: 'missing_init_data' }
  const nowSec = Math.floor(deps.now().getTime() / 1000)
  const checked = validateWebAppInitData(initData, deps.botToken, nowSec)
  if (!checked.ok) {
    if (checked.reason === 'expired') return { ok: false, status: 401, error: 'expired_init_data' }
    return { ok: false, status: 401, error: 'invalid_init_data' }
  }
  if (!deps.moderators.has(checked.userId)) {
    return { ok: false, status: 403, error: 'forbidden' }
  }
  return { ok: true, userId: checked.userId }
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

  const auth = authorize(request, deps)
  if (!auth.ok) return jsonResponse(auth.status, { error: auth.error })
  if (!deps.store) return jsonResponse(503, { error: 'unavailable' })

  const id = extractReviewId(url)

  try {
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
      return jsonResponse(405, { error: 'method_not_allowed' }, { allow: 'GET, DELETE' })
    }

    return jsonResponse(405, { error: 'method_not_allowed' }, { allow: 'GET, DELETE' })
  } catch {
    deps.log.error('storage_failed')
    return jsonResponse(503, { error: 'unavailable' })
  }
}
