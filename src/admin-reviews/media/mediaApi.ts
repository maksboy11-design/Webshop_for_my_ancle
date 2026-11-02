/** Клиент API медиатеки и шаги загрузки одного файла (Vercel Blob client upload → проверка на сервере → обработка). */
import { adminAuthHeaders, adminErrorText, adminRequest, AdminHttpError } from '../adminHttp'
import { MULTIPART_FROM_BYTES, mediaPathname, type MediaKind, type MediaLimits, type MediaVariant } from '../../cms/mediaTypes'
import type { RunContext, RunResult, UploadItem } from './uploadQueue'

export interface MediaItem {
  id: string
  kind: MediaKind
  mime: string
  size: number
  name: string
  title: string | null
  url: string
  thumb: string | null
  variants: Record<string, MediaVariant>
  width: number | null
  height: number | null
  status: 'uploading' | 'processing' | 'ready' | 'failed'
  error: string | null
  sha256: string | null
  createdAt: string
  deletedAt: string | null
}

export interface MediaUsage {
  productId: string
  role: string
  blockId: string
  position: number
  pageId?: string
  title?: string
}

export interface ProductMediaItem {
  mediaId: string
  role: 'main' | 'gallery' | 'document'
  position: number
  media: MediaItem
}

export interface MediaListParams {
  q?: string
  kind?: MediaKind | ''
  sort?: 'date' | 'size'
  dir?: 'asc' | 'desc'
  page?: number
  limit?: number
  trash?: boolean
}

const BASE = '/api/admin/media'
const enc = encodeURIComponent

export const mediaApi = {
  list: (initData: string, p: MediaListParams, signal?: AbortSignal) => {
    const qs = new URLSearchParams({ list: '1' })
    if (p.q) qs.set('q', p.q)
    if (p.kind) qs.set('kind', p.kind)
    if (p.sort) qs.set('sort', p.sort)
    if (p.dir) qs.set('dir', p.dir)
    if (p.page) qs.set('page', String(p.page))
    if (p.limit) qs.set('limit', String(p.limit))
    if (p.trash) qs.set('trash', '1')
    return adminRequest<{ total: number; page: number; limit: number; items: MediaItem[]; limits: MediaLimits }>(
      initData,
      `${BASE}?${qs}`,
      { signal },
    )
  },
  get: (initData: string, id: string) => adminRequest<{ media: MediaItem; usage: MediaUsage[] }>(initData, `${BASE}?id=${enc(id)}`),
  check: (initData: string, sha256: string, signal?: AbortSignal) =>
    adminRequest<{ media: MediaItem | null }>(initData, `${BASE}?check=1`, { method: 'POST', json: { sha256 }, signal }),
  complete: (
    initData: string,
    body: { id: string; url: string; name: string; size: number; mime: string; sha256?: string },
    signal?: AbortSignal,
  ) => adminRequest<{ media: MediaItem; duplicate: boolean }>(initData, `${BASE}?complete=1`, { method: 'POST', json: body, signal }),
  process: (initData: string, id: string) =>
    adminRequest<{ media: MediaItem | null }>(initData, `${BASE}?process=${enc(id)}`, { method: 'POST', json: {} }),
  trash: (initData: string, id: string, unlink = false) =>
    adminRequest<{ ok: true }>(initData, `${BASE}?id=${enc(id)}${unlink ? '&unlink=1' : ''}`, { method: 'DELETE' }),
  purge: (initData: string, id: string) => adminRequest<{ ok: true }>(initData, `${BASE}?id=${enc(id)}&purge=1`, { method: 'DELETE' }),
  restore: (initData: string, id: string) =>
    adminRequest<{ media: MediaItem }>(initData, `${BASE}?restore=${enc(id)}`, { method: 'POST', json: {} }),
  productMedia: (initData: string, productId: string) =>
    adminRequest<{ items: ProductMediaItem[] }>(initData, `${BASE}?product=${enc(productId)}`),
  setProductDocuments: (initData: string, productId: string, ids: string[]) =>
    adminRequest<{ items: ProductMediaItem[] }>(initData, `${BASE}?product=${enc(productId)}&documents=1`, {
      method: 'PUT',
      json: { items: ids.map((mediaId) => ({ mediaId })) },
    }),
  setTitle: (initData: string, id: string, title: string | null) =>
    adminRequest<{ media: MediaItem }>(initData, `${BASE}?id=${enc(id)}`, { method: 'PATCH', json: { title } }),
  setProductMedia: (initData: string, productId: string, items: { mediaId: string; role: 'main' | 'gallery' }[]) =>
    adminRequest<{ items: ProductMediaItem[] }>(initData, `${BASE}?product=${enc(productId)}`, { method: 'PUT', json: { items } }),
}

/** Хеш до 100 МБ считаем в браузере (проверка дубля до загрузки); больше — пропускаем, сервер сверит сам. */
const HASH_MAX_BYTES = 100 * 1024 * 1024

async function sha256Hex(file: Blob): Promise<string | null> {
  if (file.size > HASH_MAX_BYTES || !globalThis.crypto?.subtle) return null
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Временная ошибка: сеть, 5xx, 429, недоступность Blob. Ошибки валидации (4xx) не повторяем. */
export function isTransientUploadError(err: unknown): boolean {
  if (err instanceof AdminHttpError)
    return (
      err.code === 'network' ||
      err.status === 429 ||
      (err.status >= 500 && err.code !== 'storage_not_configured' && err.code !== 'media_unavailable')
    )
  if (err instanceof TypeError) return true
  const name = err instanceof Error ? err.name : ''
  return /ServiceNotAvailable|RateLimited|BlobUnknownError|NetworkError/i.test(name)
}

export function uploadErrorText(err: unknown): string {
  if (err && typeof err === 'object' && !(err instanceof Error) && typeof (err as { code?: unknown }).code === 'string') {
    return adminErrorText(new AdminHttpError(400, (err as { code: string }).code))
  }
  if (err instanceof AdminHttpError) return adminErrorText(err)
  const name = err instanceof Error ? err.name : ''
  if (/FileTooLarge/i.test(name)) return adminErrorText(new AdminHttpError(413, 'file_too_large'))
  if (/ContentTypeNotAllowed/i.test(name)) return adminErrorText(new AdminHttpError(415, 'unsupported_type'))
  if (/Aborted/i.test(name)) return adminErrorText(new AdminHttpError(0, 'aborted'))
  if (/Blob/i.test(name)) return 'Хранилище не приняло файл. Повторите позже.'
  return adminErrorText(new AdminHttpError(0, 'network'))
}

/** Один файл: хеш → проверка дубля → прямая загрузка в Blob → проверка сигнатуры/дедуп на сервере → (фон) варианты WebP. */
export function mediaUploadRunner(initData: string) {
  return async (item: UploadItem<MediaItem>, ctx: RunContext): Promise<RunResult<MediaItem>> => {
    ctx.setStatus('hashing')
    const sha = await sha256Hex(item.file)
    if (sha) {
      const found = await mediaApi.check(initData, sha, ctx.signal)
      if (found.media) return { media: found.media, duplicate: true }
    }
    ctx.setStatus('uploading')
    const { upload } = await import('@vercel/blob/client')
    const blob = await upload(mediaPathname(item.id, item.name, item.mime), item.file, {
      access: 'public',
      handleUploadUrl: `${BASE}?token=1`,
      clientPayload: JSON.stringify({ id: item.id, name: item.name, mime: item.mime, size: item.size }),
      headers: adminAuthHeaders(initData),
      contentType: item.mime,
      multipart: item.size >= MULTIPART_FROM_BYTES,
      abortSignal: ctx.signal,
      onUploadProgress: (e) => ctx.setProgress(e.total ? e.loaded / e.total : e.percentage / 100),
    })
    ctx.setStatus('verifying')
    const done = await mediaApi.complete(
      initData,
      { id: item.id, url: blob.url, name: item.name, size: item.size, mime: item.mime, ...(sha ? { sha256: sha } : {}) },
      ctx.signal,
    )
    if (done.duplicate || done.media.kind !== 'image' || done.media.status !== 'processing')
      return { media: done.media, duplicate: done.duplicate }
    return {
      media: done.media,
      duplicate: false,
      process: async () => (await mediaApi.process(initData, item.id)).media ?? done.media,
    }
  }
}
