import { jsonResponse } from './http'
import type { Log } from './logger'
import type { ReviewStore } from './store'
import { publicWebinarFromEntry, type EntryStore, type WebinarCategory } from './cmsEntries'

/** GET /api/webinars — только опубликованные и не снятые вебинары. Служебные поля не отдаются. */
export async function handleWebinarsRequest(request: Request, deps: { store: ReviewStore | null; log: Log; entries?: EntryStore | null }): Promise<Response> {
  if (request.method !== 'GET') return jsonResponse(405, { error: 'method_not_allowed' }, { allow: 'GET' })
  if (!deps.store) return jsonResponse(503, { error: 'unavailable' })
  try {
    const webinars = await deps.store.listPublicWebinars()
    // Категории и ручные записи — необязательный слой: без миграции 006 сайт работает как раньше (все — «о продукции»).
    let categories = new Map<string, WebinarCategory>()
    let manual: NonNullable<ReturnType<typeof publicWebinarFromEntry>>[] = []
    if (deps.entries) {
      try {
        categories = await deps.entries.webinarCategories(webinars.map((w) => w.id))
        manual = (await deps.entries.list('webinar', 'published')).map(publicWebinarFromEntry).filter((w) => w !== null)
      } catch {
        deps.log.error('webinar_entries_unavailable')
      }
    }
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
          category: categories.get(item.id) ?? 'products',
        })).concat(manual),
      },
      { 'cache-control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' },
    )
  } catch {
    deps.log.error('storage_failed')
    return jsonResponse(503, { error: 'unavailable' })
  }
}
