/**
 * Медиатека: защищённый /api/admin/media.
 * Файл грузится из браузера напрямую в Vercel Blob (клиентский токен с allowlist типа и лимитом размера),
 * затем «complete»: проверка сигнатуры (magic bytes) уже в Blob, sha256 и дедупликация, запись в media.
 * Изображения дополнительно обрабатываются отдельным запросом (sharp → thumb/medium/large WebP), UI не ждёт.
 */
import { createHash } from 'node:crypto'
import { PRODUCT_BLOB_HOST, toSameOriginProductMedia } from '../../src/cms/productMerge'
import {
  DEFAULT_MEDIA_LIMITS,
  IMAGE_VARIANTS,
  MEDIA_BLOB_PREFIX,
  MEDIA_TYPES,
  checkMediaFile,
  isUuid,
  kindOf,
  mediaPathname,
  sniffMatches,
  sniffMime,
  type ImageVariantName,
  type MediaKind,
  type MediaLimits,
  type MediaVariant,
} from '../../src/cms/mediaTypes'
import { authorizeAdmin, type AdminAuthDeps } from './adminAuth'
import { jsonResponse, readLimitedJson } from './http'
import type { Log } from './logger'
export { mediaToProductImage, productImagesFromLinks } from './mediaImages'
import { MediaUnavailableError, type GalleryRole, type MediaRecord, type MediaStore, type ProductMediaLink } from './mediaStore'

/** До этого размера сервер сам считает sha256 по файлу в Blob; больше — принимает хеш клиента (только для дедупликации). */
export const SERVER_HASH_MAX_BYTES = 100 * 1024 * 1024
export const DOCUMENTS_MAX = 20
const TITLE_MAX = 120
const GALLERY_LINKS_MAX = 30
const SNIFF_BYTES = 4096

export interface MediaBlob {
  clientToken(pathname: string, mime: string, maxBytes: number): Promise<string>
  /** Первые байты файла (Range). */
  head(url: string, bytes: number): Promise<Uint8Array>
  /** sha256 по потоку файла. */
  sha256(url: string): Promise<string>
  read(url: string, maxBytes: number): Promise<Buffer>
  put(pathname: string, data: Buffer, contentType: string): Promise<string>
  del(urls: string[]): Promise<void>
}

export interface EncodedVariant {
  name: ImageVariantName
  data: Buffer
  width: number
  height: number
}

export interface VariantEncoder {
  /** Варианты WebP с учётом EXIF-ориентации + размеры оригинала после поворота. */
  variants(input: Buffer): Promise<{ width: number; height: number; variants: EncodedVariant[] }>
}

export interface MediaHttpDeps extends AdminAuthDeps {
  media: MediaStore | null
  blob: MediaBlob | null
  encoder: VariantEncoder | null
  log: Log
  limits?: MediaLimits
  isProduct: (id: string) => boolean
}

/* ---------- представление ---------- */

const pub = (url: string) => toSameOriginProductMedia(url)

export function mediaView(m: MediaRecord) {
  const variants: Record<string, MediaVariant> = {}
  for (const [k, v] of Object.entries(m.variants)) variants[k] = { ...v, url: pub(v.url) }
  return {
    id: m.id,
    kind: m.kind,
    mime: m.mime,
    size: m.sizeBytes,
    name: m.originalName,
    title: m.title,
    url: pub(m.blobUrl),
    thumb: variants.thumb?.url ?? (m.kind === 'image' && m.status === 'ready' ? pub(m.blobUrl) : null),
    variants,
    width: m.width,
    height: m.height,
    status: m.status,
    error: m.error,
    sha256: m.sha256,
    createdAt: m.createdAt,
    deletedAt: m.deletedAt,
  }
}
export type MediaView = ReturnType<typeof mediaView>

/* ---------- обработка изображения ---------- */

function blobPath(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' || u.hostname.toLowerCase() !== PRODUCT_BLOB_HOST) return null
    return decodeURIComponent(u.pathname.slice(1))
  } catch {
    return null
  }
}

export async function processMediaImage(
  store: MediaStore,
  blob: MediaBlob,
  encoder: VariantEncoder,
  rec: MediaRecord,
  limits: MediaLimits,
  now: () => Date,
) {
  try {
    const input = await blob.read(rec.blobUrl, limits.image)
    const out = await encoder.variants(input)
    const variants: Record<string, MediaVariant> = {}
    for (const v of out.variants) {
      const url = await blob.put(`${MEDIA_BLOB_PREFIX}${rec.id}/${v.name}.webp`, v.data, 'image/webp')
      variants[v.name] = { url, width: v.width, height: v.height }
    }
    return await store.update(rec.id, { status: 'ready', error: null, variants, width: out.width, height: out.height }, now().toISOString())
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    const code =
      msg === 'sharp_unavailable'
        ? 'processing_unavailable'
        : /pixel limit|exceeds/i.test(msg)
          ? 'image_too_many_pixels'
          : 'image_decode_failed'
    return await store.update(rec.id, { status: 'failed', error: code }, now().toISOString())
  }
}

/* ---------- HTTP ---------- */

const KINDS: MediaKind[] = ['image', 'video', 'document']
const isSha = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)

async function body(request: Request): Promise<Record<string, unknown> | Response> {
  const parsed = await readLimitedJson(request)
  if (!parsed.ok) return jsonResponse(parsed.status, { error: 'bad_request' })
  if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return jsonResponse(400, { error: 'bad_request' })
  return parsed.value as Record<string, unknown>
}

export async function handleAdminMediaRequest(request: Request, deps: MediaHttpDeps): Promise<Response> {
  const ALLOW = 'GET, POST, PUT, PATCH, DELETE'
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method))
    return jsonResponse(405, { error: 'method_not_allowed' }, { allow: ALLOW })
  const auth = authorizeAdmin(request, deps)
  if (!auth.ok) return jsonResponse(auth.status, { error: auth.error })
  const store = deps.media
  if (!store) return jsonResponse(503, { error: 'media_unavailable' })
  const limits = deps.limits ?? DEFAULT_MEDIA_LIMITS
  const url = new URL(request.url)
  const q = url.searchParams
  const nowIso = () => deps.now().toISOString()

  try {
    /* --- клиентский токен для прямой загрузки (протокол @vercel/blob/client upload()) --- */
    if (request.method === 'POST' && q.get('token') === '1') {
      if (!deps.blob) return jsonResponse(503, { error: 'storage_not_configured' })
      const b = await body(request)
      if (b instanceof Response) return b
      const payload = (b.payload ?? {}) as Record<string, unknown>
      if (b.type !== 'blob.generate-client-token' || typeof payload.pathname !== 'string')
        return jsonResponse(400, { error: 'bad_request' })
      let meta: Record<string, unknown> = {}
      try {
        meta = JSON.parse(typeof payload.clientPayload === 'string' ? payload.clientPayload : '{}') as Record<string, unknown>
      } catch {
        return jsonResponse(400, { error: 'bad_request' })
      }
      const { id, name, mime, size } = meta
      if (!isUuid(id) || typeof name !== 'string' || typeof mime !== 'string' || typeof size !== 'number')
        return jsonResponse(400, { error: 'bad_request' })
      const bad = checkMediaFile(mime, size, limits)
      if (bad) return jsonResponse(bad === 'file_too_large' ? 413 : 415, { error: bad })
      if (payload.pathname !== mediaPathname(id, name, mime)) return jsonResponse(400, { error: 'bad_pathname' })
      const max = limits[MEDIA_TYPES[mime]!.kind]
      const clientToken = await deps.blob.clientToken(payload.pathname, mime, Math.min(max, Math.ceil(size)))
      deps.log.info('admin_media_token', { kind: MEDIA_TYPES[mime]!.kind })
      return jsonResponse(200, { type: 'blob.generate-client-token', clientToken })
    }

    /* --- дедупликация до загрузки --- */
    if (request.method === 'POST' && q.get('check') === '1') {
      const b = await body(request)
      if (b instanceof Response) return b
      if (!isSha(b.sha256)) return jsonResponse(400, { error: 'bad_request' })
      const found = await store.findBySha(b.sha256)
      return jsonResponse(200, { media: found ? mediaView(found) : null })
    }

    /* --- завершение загрузки: сигнатура, sha256, запись --- */
    if (request.method === 'POST' && q.get('complete') === '1') {
      if (!deps.blob) return jsonResponse(503, { error: 'storage_not_configured' })
      const b = await body(request)
      if (b instanceof Response) return b
      const { id, url: blobUrl, name, size, mime } = b
      if (!isUuid(id) || typeof blobUrl !== 'string' || typeof name !== 'string' || typeof size !== 'number' || typeof mime !== 'string') {
        return jsonResponse(400, { error: 'bad_request' })
      }
      const existing = await store.get(id)
      if (existing) return jsonResponse(200, { media: mediaView(existing), duplicate: false })
      const bad = checkMediaFile(mime, size, limits)
      if (bad) return jsonResponse(bad === 'file_too_large' ? 413 : 415, { error: bad })
      const path = blobPath(blobUrl)
      if (path !== mediaPathname(id, name, mime)) return jsonResponse(400, { error: 'bad_blob_url' })
      const head = await deps.blob.head(blobUrl, SNIFF_BYTES)
      if (!sniffMatches(mime, sniffMime(head))) {
        await deps.blob.del([blobUrl]).catch(() => undefined)
        deps.log.info('admin_media_rejected', { kind: 'signature' })
        return jsonResponse(422, { error: 'signature_mismatch' })
      }
      const sha = size <= SERVER_HASH_MAX_BYTES ? await deps.blob.sha256(blobUrl) : isSha(b.sha256) ? b.sha256 : null
      if (sha) {
        const dup = await store.findBySha(sha)
        if (dup) {
          await deps.blob.del([blobUrl]).catch(() => undefined)
          return jsonResponse(200, { media: mediaView(dup), duplicate: true })
        }
      }
      const kind = kindOf(mime)!
      let rec: MediaRecord
      try {
        rec = (
          await store.insert({
            id,
            kind,
            mime,
            sizeBytes: size,
            sha256: sha,
            originalName: name.slice(0, 255),
            blobUrl,
            status: kind === 'image' ? 'processing' : 'ready',
            createdByUserId: auth.userId,
            nowIso: nowIso(),
          })
        ).record
      } catch (e) {
        // Гонка двух одинаковых файлов: уникальный sha256.
        if ((e as { code?: string }).code === '23505' && sha) {
          const dup = await store.findBySha(sha)
          if (dup) {
            await deps.blob.del([blobUrl]).catch(() => undefined)
            return jsonResponse(200, { media: mediaView(dup), duplicate: true })
          }
        }
        throw e
      }
      deps.log.info('admin_media_uploaded', { kind })
      return jsonResponse(201, { media: mediaView(rec), duplicate: false })
    }

    /* --- обработка изображения (отдельный запрос; клиент не блокируется) --- */
    if (request.method === 'POST' && q.get('process')) {
      const rec = await store.get(q.get('process')!)
      if (!rec || rec.deletedAt) return jsonResponse(404, { error: 'not_found' })
      if (rec.kind !== 'image' || rec.status === 'ready') return jsonResponse(200, { media: mediaView(rec) })
      if (!deps.blob) return jsonResponse(503, { error: 'storage_not_configured' })
      if (!deps.encoder) return jsonResponse(503, { error: 'processing_unavailable' })
      const done = await processMediaImage(store, deps.blob, deps.encoder, rec, limits, deps.now)
      deps.log.info('admin_media_processed', { kind: done?.status ?? 'missing' })
      return jsonResponse(200, { media: done ? mediaView(done) : null })
    }

    if (request.method === 'POST' && q.get('restore')) {
      try {
        const rec = await store.restore(q.get('restore')!, nowIso())
        return rec ? jsonResponse(200, { media: mediaView(rec) }) : jsonResponse(404, { error: 'not_found' })
      } catch (e) {
        if ((e as { code?: string }).code === '23505') return jsonResponse(409, { error: 'duplicate_exists' })
        throw e
      }
    }

    /* --- галерея товара (product_media) --- */
    const productId = q.get('product')
    if (productId !== null) {
      if (!deps.isProduct(productId)) return jsonResponse(404, { error: 'not_found' })
      if (request.method === 'GET') return jsonResponse(200, { items: (await store.productMedia(productId)).map(linkView) })
      if (request.method === 'PUT' && q.get('documents') === '1') {
        const b = await body(request)
        if (b instanceof Response) return b
        if (!Array.isArray(b.items) || b.items.length > DOCUMENTS_MAX) return jsonResponse(400, { error: 'bad_request' })
        const items: { mediaId: string; role: GalleryRole }[] = []
        for (const it of b.items as Record<string, unknown>[]) {
          if (!it || !isUuid(it.mediaId)) return jsonResponse(400, { error: 'bad_request' })
          if (items.some((x) => x.mediaId === it.mediaId)) return jsonResponse(400, { error: 'duplicate_item' })
          const m = await store.get(it.mediaId)
          if (!m || m.deletedAt) return jsonResponse(400, { error: 'media_missing', mediaId: it.mediaId })
          if (m.kind !== 'document') return jsonResponse(400, { error: 'not_document', mediaId: it.mediaId })
          items.push({ mediaId: it.mediaId, role: 'document' })
        }
        const saved = await store.setProductMedia(productId, items, 'documents')
        deps.log.info('admin_product_documents_saved', { attachments: items.length })
        return jsonResponse(200, { items: saved.map(linkView) })
      }
      if (request.method === 'PUT') {
        const b = await body(request)
        if (b instanceof Response) return b
        if (!Array.isArray(b.items) || b.items.length > GALLERY_LINKS_MAX + 1) return jsonResponse(400, { error: 'bad_request' })
        const items: { mediaId: string; role: GalleryRole }[] = []
        const seen = new Set<string>()
        for (const it of b.items as Record<string, unknown>[]) {
          if (!it || !isUuid(it.mediaId) || (it.role !== 'main' && it.role !== 'gallery'))
            return jsonResponse(400, { error: 'bad_request' })
          const key = `${it.role}:${it.mediaId}`
          if (seen.has(key)) return jsonResponse(400, { error: 'duplicate_item' })
          seen.add(key)
          const m = await store.get(it.mediaId)
          if (!m || m.deletedAt) return jsonResponse(400, { error: 'media_missing', mediaId: it.mediaId })
          if (m.kind !== 'image') return jsonResponse(400, { error: 'not_image', mediaId: it.mediaId })
          items.push({ mediaId: it.mediaId, role: it.role })
        }
        if (items.filter((i) => i.role === 'main').length > 1) return jsonResponse(400, { error: 'one_main_only' })
        const saved = await store.setProductMedia(productId, items)
        deps.log.info('admin_product_media_saved', { attachments: saved.length })
        return jsonResponse(200, { items: saved.map(linkView) })
      }
      return jsonResponse(405, { error: 'method_not_allowed' }, { allow: 'GET, PUT' })
    }

    const id = q.get('id')
    if (request.method === 'GET' && id) {
      const rec = await store.get(id)
      if (!rec) return jsonResponse(404, { error: 'not_found' })
      return jsonResponse(200, { media: mediaView(rec), usage: await store.usage(id) })
    }

    if (request.method === 'PATCH' && id) {
      const b = await body(request)
      if (b instanceof Response) return b
      if (b.title !== null && typeof b.title !== 'string') return jsonResponse(400, { error: 'bad_request', field: 'title' })
      const title = typeof b.title === 'string' ? b.title.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX) || null : null
      const cur = await store.get(id)
      if (!cur || cur.deletedAt) return jsonResponse(404, { error: 'not_found' })
      const rec = await store.update(id, { title }, nowIso())
      return jsonResponse(200, { media: mediaView(rec ?? cur) })
    }

    if (request.method === 'DELETE' && id) {
      if (q.get('purge') === '1') {
        const r = await store.purge(id)
        if (r.result !== 'ok') return jsonResponse(r.result === 'not_found' ? 404 : 409, { error: r.result })
        if (deps.blob) {
          const urls = [r.record.blobUrl, ...Object.values(r.record.variants).map((v) => v.url)]
          await deps.blob
            .del(urls)
            .catch((e) => deps.log.error('admin_media_blob_delete_failed', { errorClass: e instanceof Error ? e.name : 'unknown' }))
        }
        deps.log.info('admin_media_purged', { kind: r.record.kind })
        return jsonResponse(200, { ok: true })
      }
      const r = await store.trash(id, q.get('unlink') === '1', nowIso())
      if (r === 'not_found') return jsonResponse(404, { error: 'not_found' })
      if (r === 'in_use') return jsonResponse(409, { error: 'in_use', usage: await store.usage(id) })
      deps.log.info('admin_media_trashed', {})
      return jsonResponse(200, { ok: true })
    }

    if (request.method === 'GET') {
      const kind = q.get('kind')
      const limit = Math.min(Math.max(Number(q.get('limit')) || 24, 1), 100)
      const page = Math.max(Number(q.get('page')) || 1, 1)
      const r = await store.list({
        q: (q.get('q') ?? '').slice(0, 100),
        kind: KINDS.includes(kind as MediaKind) ? (kind as MediaKind) : null,
        sort: q.get('sort') === 'size' ? 'size' : 'date',
        dir: q.get('dir') === 'asc' ? 'asc' : 'desc',
        offset: (page - 1) * limit,
        limit,
        trash: q.get('trash') === '1',
      })
      return jsonResponse(200, { total: r.total, page, limit, items: r.items.map(mediaView), limits })
    }
    return jsonResponse(400, { error: 'bad_request' })
  } catch (error) {
    if (error instanceof MediaUnavailableError) return jsonResponse(503, { error: 'media_unavailable' })
    deps.log.error('admin_media_failed', { errorClass: error instanceof Error ? error.name : 'unknown' })
    return jsonResponse(500, { error: 'internal' })
  }
}

function linkView(l: ProductMediaLink) {
  return { mediaId: l.mediaId, role: l.role, position: l.position, media: mediaView(l.media) }
}

/* ---------- продакшн-реализации ---------- */

export function vercelMediaBlob(token: string): MediaBlob {
  const checkHost = (u: string) => {
    if (new URL(u).hostname !== PRODUCT_BLOB_HOST) throw new Error('unexpected_blob_host')
  }
  return {
    async clientToken(pathname, mime, maxBytes) {
      const { generateClientTokenFromReadWriteToken } = await import('@vercel/blob/client')
      return generateClientTokenFromReadWriteToken({
        token,
        pathname,
        allowedContentTypes: [mime],
        maximumSizeInBytes: maxBytes,
        addRandomSuffix: false,
        allowOverwrite: false,
        cacheControlMaxAge: 31_536_000,
        validUntil: Date.now() + 60 * 60 * 1000,
      })
    },
    async head(url, bytes) {
      checkHost(url)
      const r = await fetch(url, { headers: { range: `bytes=0-${bytes - 1}` }, cache: 'no-store' })
      if (!r.ok) throw new Error(`blob_head_${r.status}`)
      return new Uint8Array(await r.arrayBuffer()).subarray(0, bytes)
    },
    async sha256(url) {
      checkHost(url)
      const r = await fetch(url, { cache: 'no-store' })
      if (!r.ok || !r.body) throw new Error(`blob_read_${r.status}`)
      const h = createHash('sha256')
      const reader = r.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        h.update(value)
      }
      return h.digest('hex')
    },
    async read(url, maxBytes) {
      checkHost(url)
      const r = await fetch(url, { cache: 'no-store' })
      if (!r.ok) throw new Error(`blob_read_${r.status}`)
      const buf = Buffer.from(await r.arrayBuffer())
      if (buf.length > maxBytes) throw new Error('file_too_large')
      return buf
    },
    async put(pathname, data, contentType) {
      const { put } = await import('@vercel/blob')
      const r = await put(pathname, data, {
        access: 'public',
        token,
        contentType,
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 31_536_000,
      })
      checkHost(r.url)
      return r.url
    },
    async del(urls) {
      if (!urls.length) return
      urls.forEach(checkHost)
      const { del } = await import('@vercel/blob')
      await del(urls, { token })
    },
  }
}

interface SharpChain {
  rotate: () => SharpChain
  clone: () => SharpChain
  metadata: () => Promise<{ width?: number; height?: number; orientation?: number }>
  resize: (o: { width: number; height: number; fit: 'inside'; withoutEnlargement: boolean }) => SharpChain
  webp: (o: { quality: number; effort: number }) => SharpChain
  toBuffer: (o: { resolveWithObject: true }) => Promise<{ data: Buffer; info: { width: number; height: number } }>
}
type SharpFactory = (input: Buffer, o: { limitInputPixels: number; failOn: 'error'; pages: number }) => SharpChain
let sharpP: Promise<SharpFactory | null> | null = null

export function sharpVariantEncoder(maxPixels = 40_000_000): VariantEncoder {
  return {
    async variants(input) {
      sharpP ??= import('sharp').then((m) => ((m as { default?: unknown }).default ?? m) as SharpFactory).catch(() => null)
      const sharp = await sharpP
      if (!sharp) throw new Error('sharp_unavailable')
      const base = sharp(input, { limitInputPixels: maxPixels, failOn: 'error', pages: 1 })
      const meta = await base.metadata()
      const swap = (meta.orientation ?? 1) >= 5
      const width = (swap ? meta.height : meta.width) ?? 1
      const height = (swap ? meta.width : meta.height) ?? 1
      const variants: EncodedVariant[] = []
      for (const [name, box] of Object.entries(IMAGE_VARIANTS) as [ImageVariantName, number][]) {
        const out = await base
          .clone()
          .rotate() // EXIF-ориентация
          .resize({ width: box, height: box, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: name === 'thumb' ? 72 : 82, effort: 4 })
          .toBuffer({ resolveWithObject: true })
        variants.push({ name, data: out.data, width: out.info.width, height: out.info.height })
      }
      return { width, height, variants }
    },
  }
}

export function mediaLimitsFromEnv(env: Record<string, string | undefined>): MediaLimits {
  const mb = (v: string | undefined, d: number) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? Math.floor(n * 1024 * 1024) : d
  }
  return {
    image: mb(env.MEDIA_MAX_IMAGE_MB, DEFAULT_MEDIA_LIMITS.image),
    video: mb(env.MEDIA_MAX_VIDEO_MB, DEFAULT_MEDIA_LIMITS.video),
    document: mb(env.MEDIA_MAX_DOCUMENT_MB, DEFAULT_MEDIA_LIMITS.document),
  }
}
