import { jsonResponse } from './http'
import type { Log } from './logger'
import type { ReviewStore } from './store'

/** GET /api/webinars — только опубликованные и не снятые вебинары. Служебные поля не отдаются. */
export async function handleWebinarsRequest(request: Request, deps: { store: ReviewStore | null; log: Log }): Promise<Response> {
  if (request.method !== 'GET') return jsonResponse(405, { error: 'method_not_allowed' }, { allow: 'GET' })
  if (!deps.store) return jsonResponse(503, { error: 'unavailable' })
  try {
    const webinars = await deps.store.listPublicWebinars()
    return jsonResponse(
      200,
      {
        webinars: webinars.map((item) => ({
          id: item.id,
          title: item.title,
          speaker: item.speaker,
          date: item.date,
          sourceType: item.sourceType,
          youtubeVideoId: item.youtubeVideoId,
          startSeconds: item.startSeconds,
          recordingSrc: item.recordingSrc,
        })),
      },
      { 'cache-control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' },
    )
  } catch {
    deps.log.error('storage_failed')
    return jsonResponse(503, { error: 'unavailable' })
  }
}
