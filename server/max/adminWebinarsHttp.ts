/**
 * /api/admin/webinars — список, карточка, правка, снятие/отклонение вебинаров из Mini App.
 * Публикация по-прежнему через /webinars_pending в боте. Правка опубликованной записи не может
 * оставить сайт без рабочего вебинара: при неуспешной проверке источника запись не меняется.
 */
import { authorizeAdmin, type AdminAuthDeps } from './adminAuth'
import { jsonResponse, readLimitedJson } from './http'
import type { Log } from './logger'
import type { ReviewStore, WebinarRecord, WebinarStatus } from './store'
import { reviewId } from './text'
import { isAllowedRecordingSrc, toPublicWebinar } from './webinars'
import {
  WEBINAR_SPEAKER_MAX,
  WEBINAR_TITLE_MAX,
  YOUTUBE_ID,
  blocksPublication,
  fetchYoutubeMetadata,
  metadataStatusText,
  parseStartTime,
  parseWebinarDate,
  parseYoutubeUrl,
  type YoutubeMetadata,
  type YoutubeMetadataDeps,
} from './youtubeImport'

export interface AdminWebinarsDeps extends AdminAuthDeps {
  store: ReviewStore | null
  log: Log
  youtube: YoutubeMetadataDeps
}

const STATUSES: readonly WebinarStatus[] = ['pending', 'published', 'withdrawn', 'rejected']
const PAGE_MAX = 50
const ALLOW = 'GET, PATCH, DELETE'
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]/

function extractId(url: URL): string | null | 'invalid' {
  let raw = url.searchParams.get('id')
  if (!raw) {
    const parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean)
    if (parts.length >= 4 && parts[0] === 'api' && parts[1] === 'admin' && parts[2] === 'webinars') raw = parts[3] ?? null
  }
  if (!raw) return null
  return reviewId(raw) ?? 'invalid'
}

export function toAdminWebinar(r: WebinarRecord) {
  return {
    id: r.id,
    status: r.status,
    title: r.title,
    speaker: r.speaker,
    date: r.eventDate,
    sourceType: r.sourceType,
    youtubeVideoId: r.youtubeVideoId,
    startSeconds: r.startSeconds,
    recordingSrc: r.recordingSrc,
    youtubeTitle: r.youtubeTitle,
    metadataStatus: r.metadataStatus,
    metadataText: metadataStatusText(r.metadataStatus),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    publishedAt: r.publishedAt,
    withdrawnAt: r.withdrawnAt,
    fromGroup: !!r.contentId,
  }
}

function cleanLine(v: unknown, max: number): string | null | 'invalid' {
  if (v === null || v === '') return null
  if (typeof v !== 'string') return 'invalid'
  const t = v.trim()
  if (!t) return null
  if (CONTROL.test(t) || Array.from(t).length > max) return 'invalid'
  return t
}

export interface WebinarEdit {
  title?: string
  speaker?: string | null
  eventDate?: string | null
  source?: { type: 'youtube'; videoId: string; startSeconds: number | null } | { type: 'hosted'; src: string }
  startSeconds?: number | null
  recheck?: boolean
}

export function parseWebinarEdit(body: unknown): { ok: true; edit: WebinarEdit } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'invalid_body' }
  const b = body as Record<string, unknown>
  const known = new Set(['title', 'speaker', 'date', 'source', 'startSeconds', 'recheck', 'expectedUpdatedAt'])
  for (const k of Object.keys(b)) if (!known.has(k)) return { ok: false, error: 'unknown_field' }
  const edit: WebinarEdit = {}
  if ('title' in b) {
    const t = cleanLine(b.title, WEBINAR_TITLE_MAX)
    if (t === 'invalid') return { ok: false, error: 'title_invalid' }
    if (t === null) return { ok: false, error: 'title_required' }
    edit.title = t
  }
  if ('speaker' in b) {
    const s = cleanLine(b.speaker, WEBINAR_SPEAKER_MAX)
    if (s === 'invalid') return { ok: false, error: 'speaker_invalid' }
    edit.speaker = s
  }
  if ('date' in b) {
    if (b.date === null || b.date === '') edit.eventDate = null
    else {
      const d = typeof b.date === 'string' ? parseWebinarDate(b.date) : null
      if (!d) return { ok: false, error: 'date_invalid' }
      edit.eventDate = d
    }
  }
  if ('startSeconds' in b) {
    if (b.startSeconds === null || b.startSeconds === '' || b.startSeconds === 0) edit.startSeconds = null
    else if (typeof b.startSeconds === 'number') {
      if (!Number.isInteger(b.startSeconds) || b.startSeconds < 0 || b.startSeconds > 86400) return { ok: false, error: 'start_invalid' }
      edit.startSeconds = b.startSeconds
    } else if (typeof b.startSeconds === 'string') {
      const hms = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/.exec(b.startSeconds.trim())
      const sec = hms ? Number(hms[1] ?? 0) * 3600 + Number(hms[2]) * 60 + Number(hms[3]) : parseStartTime(b.startSeconds)
      if (sec === null || sec > 86400 || (hms && Number(hms[3]) > 59)) return { ok: false, error: 'start_invalid' }
      edit.startSeconds = sec
    } else return { ok: false, error: 'start_invalid' }
  }
  if ('source' in b) {
    const s = b.source as Record<string, unknown> | null
    if (!s || typeof s !== 'object') return { ok: false, error: 'source_invalid' }
    if (s.type === 'youtube') {
      const raw = typeof s.url === 'string' ? s.url.trim() : ''
      if (YOUTUBE_ID.test(raw)) edit.source = { type: 'youtube', videoId: raw, startSeconds: null }
      else {
        const ref = parseYoutubeUrl(raw)
        if (!ref) return { ok: false, error: 'youtube_url_invalid' }
        edit.source = { type: 'youtube', videoId: ref.videoId, startSeconds: ref.startSeconds }
      }
    } else if (s.type === 'hosted') {
      const src = typeof s.src === 'string' ? s.src.trim() : ''
      if (src.length > 1000 || !isAllowedRecordingSrc(src)) return { ok: false, error: 'hosted_src_invalid' }
      edit.source = { type: 'hosted', src }
    } else return { ok: false, error: 'source_invalid' }
  }
  if (b.recheck === true) edit.recheck = true
  return { ok: true, edit }
}

function applyEdit(r: WebinarRecord, e: WebinarEdit, meta: YoutubeMetadata | null, nowIso: string): WebinarRecord {
  const next: WebinarRecord = { ...r, updatedAt: nowIso }
  if (e.title !== undefined) next.title = e.title
  if (e.speaker !== undefined) next.speaker = e.speaker
  if (e.eventDate !== undefined) next.eventDate = e.eventDate
  if (e.source?.type === 'hosted') {
    Object.assign(next, {
      sourceType: 'hosted',
      recordingSrc: e.source.src,
      youtubeVideoId: null,
      startSeconds: null,
      youtubeTitle: null,
      youtubePublishedAt: null,
      metadataStatus: 'hosted',
    } satisfies Partial<WebinarRecord>)
  } else if (e.source?.type === 'youtube') {
    const changed = r.sourceType !== 'youtube' || r.youtubeVideoId !== e.source.videoId
    next.sourceType = 'youtube'
    next.recordingSrc = null
    next.youtubeVideoId = e.source.videoId
    if (changed || e.source.startSeconds !== null) next.startSeconds = e.source.startSeconds
  }
  if (e.startSeconds !== undefined && next.sourceType === 'youtube') next.startSeconds = e.startSeconds
  if (meta && next.sourceType === 'youtube') {
    next.metadataStatus = meta.status
    next.youtubeTitle = meta.title
    next.youtubePublishedAt = meta.publishedAt
  }
  return next
}

function isUniqueViolation(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { code?: unknown }).code === '23505'
}

export async function handleAdminWebinarsRequest(request: Request, deps: AdminWebinarsDeps): Promise<Response> {
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return jsonResponse(400, { error: 'bad_request' })
  }
  const auth = authorizeAdmin(request, deps)
  if (!auth.ok) return jsonResponse(auth.status, { error: auth.error })
  if (!deps.store) return jsonResponse(503, { error: 'unavailable' })
  const store = deps.store
  const id = extractId(url)
  if (id === 'invalid') return jsonResponse(404, { error: 'not_found' })

  try {
    if (!id) {
      if (request.method !== 'GET') return jsonResponse(405, { error: 'method_not_allowed' }, { allow: ALLOW })
      const statusRaw = url.searchParams.get('status') ?? 'all'
      if (statusRaw !== 'all' && !STATUSES.includes(statusRaw as WebinarStatus)) return jsonResponse(400, { error: 'invalid_status' })
      const q = (url.searchParams.get('q') ?? '').trim().slice(0, 100)
      const limit = Math.min(PAGE_MAX, Math.max(1, Number(url.searchParams.get('limit') ?? 20) || 20))
      const offset = Math.max(0, Math.min(10_000, Number(url.searchParams.get('offset') ?? 0) || 0))
      const result = await store.transaction((tx) =>
        tx.searchWebinars({ status: statusRaw === 'all' ? null : (statusRaw as WebinarStatus), q, limit, offset }),
      )
      return jsonResponse(200, { total: result.total, webinars: result.items.map(toAdminWebinar) })
    }

    if (request.method === 'GET') {
      const item = await store.transaction((tx) => tx.getWebinar(id))
      if (!item) return jsonResponse(404, { error: 'not_found' })
      return jsonResponse(200, { webinar: toAdminWebinar(item) })
    }

    if (request.method === 'DELETE') {
      const atIso = deps.now().toISOString()
      const outcome = await store.transaction(async (tx) => {
        const row = await tx.lockWebinar(id)
        if (!row) return { status: 404, body: { error: 'not_found' } }
        if (row.status === 'published') {
          await tx.withdrawWebinar(id, auth.userId, atIso)
          return { status: 200, body: { ok: true, status: 'withdrawn' } }
        }
        if (row.status === 'pending') {
          await tx.rejectWebinar(id, auth.userId, atIso)
          return { status: 200, body: { ok: true, status: 'rejected' } }
        }
        return { status: 200, body: { ok: true, status: row.status, already: true } }
      })
      if (outcome.status === 200) deps.log.info('admin_webinar_removed', { kind: String(outcome.body.status) })
      const fresh = outcome.status === 200 ? await store.transaction((tx) => tx.getWebinar(id)) : null
      return jsonResponse(outcome.status, fresh ? { ...outcome.body, webinar: toAdminWebinar(fresh) } : outcome.body)
    }

    if (request.method === 'PATCH') {
      const body = await readLimitedJson(request)
      if (!body.ok) return jsonResponse(body.status, { error: 'bad_request' })
      const parsed = parseWebinarEdit(body.value)
      if (!parsed.ok) return jsonResponse(400, { error: parsed.error })
      const edit = parsed.edit
      const expected = (body.value as { expectedUpdatedAt?: unknown }).expectedUpdatedAt
      const before = await store.transaction((tx) => tx.getWebinar(id))
      if (!before) return jsonResponse(404, { error: 'not_found' })
      if (before.status !== 'pending' && before.status !== 'published') return jsonResponse(409, { error: 'not_editable' })
      // Сеть — вне транзакции: проверка YouTube при смене ролика или по запросу.
      let meta: YoutubeMetadata | null = null
      const newVideo = edit.source?.type === 'youtube' ? edit.source.videoId : null
      if (newVideo && (newVideo !== before.youtubeVideoId || before.sourceType !== 'youtube' || edit.recheck)) {
        meta = await fetchYoutubeMetadata(newVideo, deps.youtube)
      } else if (edit.recheck && before.sourceType === 'youtube' && before.youtubeVideoId) {
        meta = await fetchYoutubeMetadata(before.youtubeVideoId, deps.youtube)
      }
      const nowIso = deps.now().toISOString()
      const outcome = await store.transaction(async (tx) => {
        const current = await tx.lockWebinar(id)
        if (!current) return { status: 404, body: { error: 'not_found' } as Record<string, unknown> }
        if (typeof expected === 'string' && expected !== current.updatedAt) return { status: 409, body: { error: 'stale' } }
        if (current.status !== 'pending' && current.status !== 'published') return { status: 409, body: { error: 'not_editable' } }
        const next = applyEdit(current, edit, meta, nowIso)
        if (current.status === 'published') {
          if (!toPublicWebinar(next) || (next.sourceType === 'youtube' && blocksPublication(next.metadataStatus))) {
            return {
              status: 422,
              body: { error: 'verification_failed', metadataStatus: next.metadataStatus, metadataText: metadataStatusText(next.metadataStatus) },
            }
          }
        }
        const saved = await tx.saveWebinarEdit(next)
        if (saved === 'conflict') return { status: 409, body: { error: 'duplicate_video' } }
        return { status: 200, body: { webinar: toAdminWebinar(next) } }
      })
      if (outcome.status === 200) deps.log.info('admin_webinar_edited', { kind: Object.keys(edit).join(',') })
      return jsonResponse(outcome.status, outcome.body)
    }

    return jsonResponse(405, { error: 'method_not_allowed' }, { allow: ALLOW })
  } catch (error) {
    if (isUniqueViolation(error)) return jsonResponse(409, { error: 'duplicate_video' })
    deps.log.error('storage_failed', { errorClass: error instanceof Error ? error.name : 'unknown' })
    return jsonResponse(503, { error: 'unavailable' })
  }
}
