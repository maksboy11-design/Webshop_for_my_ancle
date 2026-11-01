/**
 * /api/admin/entries — ручное добавление товаров, отзывов и вебинаров из Mini App.
 * GET ?kind=&status=  — список; GET ?id= — одна запись
 * POST {kind, data}   — создать (черновик или сразу публикация, если все обязательные поля заполнены)
 * PATCH ?id= {data}   — изменить; статус пересчитывается
 * DELETE ?id=         — снять с сайта (status = withdrawn, строка остаётся)
 * PATCH ?webinarId= {category} — категория вебинара, пришедшего через бота.
 * Авторизация — как у остальных админ-API: подписанные initData MAX + MAX_REVIEW_MODERATOR_IDS.
 */
import { randomUUID } from 'node:crypto'
import { authorizeAdmin, type AdminAuthDeps } from './adminAuth'
import {
  EntriesMigrationPending,
  REQUIRED_FIELDS,
  WEBINAR_CATEGORIES,
  isEntryKind,
  missingFields,
  normalizeEntryData,
  statusFor,
  type CmsEntry,
  type EntryStatus,
  type EntryStore,
  type WebinarCategory,
} from './cmsEntries'
import { jsonResponse, readLimitedJson } from './http'
import type { Log } from './logger'
import { reviewId } from './text'

export interface AdminEntriesDeps extends AdminAuthDeps {
  entries: EntryStore | null
  log: Log
}

const ALLOW = 'GET, POST, PATCH, DELETE'

export function toAdminEntry(e: CmsEntry) {
  return {
    id: e.id,
    kind: e.kind,
    status: e.status,
    data: e.data,
    missing: missingFields(e.kind, e.data),
    required: REQUIRED_FIELDS[e.kind],
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  }
}

function failure(error: unknown, log: Log): Response {
  if (error instanceof EntriesMigrationPending) return jsonResponse(503, { error: 'migration_pending' })
  log.error('entries_storage_failed', { errorClass: error instanceof Error ? error.name : 'unknown' })
  return jsonResponse(503, { error: 'unavailable' })
}

export async function handleAdminEntriesRequest(request: Request, deps: AdminEntriesDeps): Promise<Response> {
  const auth = authorizeAdmin(request, deps)
  if (!auth.ok) return jsonResponse(auth.status, { error: auth.error })
  if (!deps.entries) return jsonResponse(503, { error: 'unavailable' })
  const url = new URL(request.url)
  const rawId = url.searchParams.get('id')
  const id = rawId ? reviewId(rawId) : null
  if (rawId && !id) return jsonResponse(400, { error: 'invalid_id' })
  const nowIso = deps.now().toISOString()
  try {
    if (request.method === 'GET') {
      const webinarIds = url.searchParams.get('webinarIds')
      if (webinarIds !== null) {
        const ids = webinarIds.split(',').map((v) => reviewId(v)).filter((v): v is string => v !== null).slice(0, 200)
        const map = await deps.entries.webinarCategories(ids)
        return jsonResponse(200, { categories: Object.fromEntries(ids.map((i) => [i, map.get(i) ?? 'products'])) })
      }
      if (id) {
        const e = await deps.entries.get(id)
        return e ? jsonResponse(200, { entry: toAdminEntry(e) }) : jsonResponse(404, { error: 'not_found' })
      }
      const kind = url.searchParams.get('kind')
      if (kind !== null && !isEntryKind(kind)) return jsonResponse(400, { error: 'invalid_kind' })
      const status = url.searchParams.get('status')
      if (status !== null && !['draft', 'published', 'withdrawn'].includes(status)) return jsonResponse(400, { error: 'invalid_status' })
      const list = await deps.entries.list(kind, status as EntryStatus | null)
      return jsonResponse(200, { entries: list.map(toAdminEntry) })
    }
    if (request.method === 'POST') {
      const body = await readLimitedJson(request)
      if (!body.ok) return jsonResponse(400, { error: 'bad_request' })
      const input = body.value as { kind?: unknown; data?: unknown }
      if (!isEntryKind(input?.kind)) return jsonResponse(400, { error: 'invalid_kind' })
      const norm = normalizeEntryData(input.kind, input.data ?? {})
      if (!norm.ok) return jsonResponse(400, norm.error)
      const entry: CmsEntry = {
        id: randomUUID(),
        kind: input.kind,
        status: statusFor(input.kind, norm.data),
        data: norm.data,
        createdAt: nowIso,
        updatedAt: nowIso,
        updatedByUserId: auth.userId,
      }
      await deps.entries.save(entry)
      return jsonResponse(201, { entry: toAdminEntry(entry) })
    }
    if (request.method === 'PATCH') {
      const webinarRaw = url.searchParams.get('webinarId')
      if (webinarRaw) {
        const webinarId = reviewId(webinarRaw)
        if (!webinarId) return jsonResponse(400, { error: 'invalid_id' })
        const body = await readLimitedJson(request)
        const category = body.ok ? (body.value as { category?: unknown })?.category : null
        if (typeof category !== 'string' || !(WEBINAR_CATEGORIES as readonly string[]).includes(category)) {
          return jsonResponse(400, { error: 'invalid', field: 'category' })
        }
        const r = await deps.entries.setWebinarCategory(webinarId, category as WebinarCategory)
        return r === 'updated' ? jsonResponse(200, { id: webinarId, category }) : jsonResponse(404, { error: 'not_found' })
      }
      if (!id) return jsonResponse(400, { error: 'invalid_id' })
      const existing = await deps.entries.get(id)
      if (!existing) return jsonResponse(404, { error: 'not_found' })
      const body = await readLimitedJson(request)
      if (!body.ok) return jsonResponse(400, { error: 'bad_request' })
      const norm = normalizeEntryData(existing.kind, (body.value as { data?: unknown })?.data ?? {})
      if (!norm.ok) return jsonResponse(400, norm.error)
      // Снятая с сайта запись остаётся снятой, пока модератор её не опубликует заново (status=publish).
      const wantsRepublish = (body.value as { republish?: unknown })?.republish === true
      const next = statusFor(existing.kind, norm.data)
      const status: EntryStatus = existing.status === 'withdrawn' && !wantsRepublish ? 'withdrawn' : next
      const entry: CmsEntry = { ...existing, data: norm.data, status, updatedAt: nowIso, updatedByUserId: auth.userId }
      await deps.entries.save(entry)
      return jsonResponse(200, { entry: toAdminEntry(entry) })
    }
    if (request.method === 'DELETE') {
      if (!id) return jsonResponse(400, { error: 'invalid_id' })
      const existing = await deps.entries.get(id)
      if (!existing) return jsonResponse(404, { error: 'not_found' })
      if (existing.status === 'withdrawn') return jsonResponse(409, { error: 'already_withdrawn' })
      await deps.entries.save({ ...existing, status: 'withdrawn', updatedAt: nowIso, updatedByUserId: auth.userId })
      return jsonResponse(200, { id, status: 'withdrawn' })
    }
    return jsonResponse(405, { error: 'method_not_allowed' }, { allow: ALLOW })
  } catch (error) {
    return failure(error, deps.log)
  }
}
