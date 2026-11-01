/**
 * Товары: публичный GET /api/products и защищённый /api/admin/products.
 * Публичный ответ — только объединённые публичные поля; без таблицы/БД — статический каталог (сайт не ломается).
 */
import { PRODUCTS, brandName, productById } from '../../src/data/products'
import { mergeProduct, toPublicProductData, type ProductOverride } from '../../src/cms/productMerge'
import { authorizeAdmin, type AdminAuthDeps } from './adminAuth'
import { jsonResponse, readLimitedJson } from './http'
import type { Log } from './logger'
import { ProductOverridesUnavailableError, type ProductOverrideStore, type StoredProductOverride } from './productOverrideStore'
import { applyProductPatch, isKnownProductId } from './productOverrides'
import { publicProductFromEntry, type EntryStore } from './cmsEntries'
import { ProductContentUnavailableError, type ProductContentStore, type StoredProductContent } from './productContentStore'
import { contentToDoc, docToContent } from '../../src/cms/contentDoc'
import { canonicalDoc, docToPlainText, toEditableDoc, validateDescriptionDoc } from '../../src/cms/descriptionDoc'
import { MediaUnavailableError, type MediaStore } from './mediaStore'
import { mediaToProductImage, productDocumentsFromLinks, productImagesFromLinks } from './mediaImages'
import type { ProductDocument, ProductExtras } from '../../src/data/products'
import { applyExtras, checkExtrasInput, publicExtras, readExtras, type MediaResolver } from '../../src/cms/richBlocks'
import { UPLOAD_MAX_BYTES, processProductImage, type BlobPutter, type ImageEncoder } from './productImages'

export const PUBLIC_PRODUCTS_CACHE = 'public, max-age=0, s-maxage=30, stale-while-revalidate=300'

function errorClass(error: unknown): string {
  if (error instanceof ProductOverridesUnavailableError) return 'overrides_table_missing'
  return error instanceof Error ? error.name : 'unknown'
}

export interface PublicProductsDeps {
  overrides: ProductOverrideStore | null
  log: Log
  entries?: EntryStore | null
  /** Опубликованный модульный контент (product_content). Нет таблицы/записи — прежнее описание. */
  content?: ProductContentStore | null
  /** Галереи из медиатеки (product_media). Нет связей/таблицы — прежние поля image/gallery. */
  media?: MediaStore | null
}

export async function handlePublicProductsRequest(request: Request, deps: PublicProductsDeps): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return jsonResponse(405, { error: 'method_not_allowed' }, { allow: 'GET' })
  }
  const url = new URL(request.url)
  const changedOnly = url.searchParams.get('changed') === '1'
  let map = new Map<string, StoredProductOverride>()
  let source: 'db' | 'static' = 'static'
  if (deps.overrides) {
    try {
      map = await deps.overrides.list()
      source = 'db'
    } catch (error) {
      deps.log.error('products_overrides_unavailable', { errorClass: errorClass(error) })
    }
  }
  const overrides = new Map<string, ProductOverride>([...map].map(([k, v]) => [k, v.overrides]))
  const extras = new Map<string, ProductExtras>()
  // Описание из опубликованного контента v2 перекрывает старое; ошибка/нет таблицы — прежний путь.
  if (deps.content) {
    try {
      for (const [id, published] of await deps.content.listPublished()) {
        overrides.set(id, { ...(overrides.get(id) ?? {}), description: contentToDoc(published) })
        const x = publicExtras(published)
        if (x.blocks.length || x.videos.length) extras.set(id, x)
      }
    } catch (error) {
      deps.log.error('product_content_unavailable', { errorClass: error instanceof ProductContentUnavailableError ? 'content_table_missing' : errorClass(error) })
    }
  }
  const documents = new Map<string, ProductDocument[]>()
  if (deps.media) {
    try {
      for (const [id, links] of await deps.media.allProductImages()) {
        const imgs = productImagesFromLinks(links)
        if (imgs.image || imgs.gallery) overrides.set(id, { ...(overrides.get(id) ?? {}), ...imgs })
        const docs = productDocumentsFromLinks(links)
        if (docs.length) documents.set(id, docs)
      }
    } catch (error) {
      deps.log.error('product_media_unavailable', {
        errorClass: error instanceof MediaUnavailableError ? 'media_table_missing' : errorClass(error),
      })
    }
  }
  const list = (changedOnly ? PRODUCTS.filter((p) => overrides.has(p.id) || documents.has(p.id) || extras.has(p.id)) : PRODUCTS).map((p) =>
    toPublicProductData({ ...mergeProduct(p, overrides.get(p.id)), documents: documents.get(p.id), extras: extras.get(p.id) }),
  )
  // Новые товары, добавленные в Mini App (cms_entries). Без миграции 006 — пусто.
  let added: NonNullable<ReturnType<typeof publicProductFromEntry>>[] = []
  if (deps.entries) {
    try {
      added = (await deps.entries.list('product', 'published')).map(publicProductFromEntry).filter((p) => p !== null)
    } catch {
      deps.log.error('product_entries_unavailable')
    }
  }
  // Кешируем только успешный ответ из БД; статический резерв — коротко, чтобы быстро подхватить восстановление.
  const cache = source === 'db' ? PUBLIC_PRODUCTS_CACHE : 'public, max-age=0, s-maxage=5'
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
    'cache-control': cache,
  })
  return new Response(JSON.stringify(added.length ? { source, products: list, added } : { source, products: list }), { status: 200, headers })
}

export interface AdminProductsDeps extends AdminAuthDeps {
  overrides: ProductOverrideStore | null
  log: Log
  encoder: ImageEncoder | null
  putBlob: BlobPutter | null
  content?: ProductContentStore | null
  /** Медиатека: проверка фото/видео/обложек в дополнительных блоках. */
  media?: MediaStore | null
}

function contentView(id: string, c: StoredProductContent | null) {
  return {
    productId: id,
    draftDoc: c && c.draftRev > 0 ? contentToDoc(c.draft) : null,
    hasDraft: !!c,
    publishedDoc: c?.published ? contentToDoc(c.published) : null,
    hasPublished: !!c?.published && c.status === 'published',
    status: c?.status ?? null,
    draftRev: c?.draftRev ?? 0,
    publishedRev: c?.publishedRev ?? null,
    updatedAt: c?.updatedAt ?? null,
    publishedAt: c?.publishedAt ?? null,
    draftExtras: readExtras(c?.draft),
    publishedExtras: c?.published ? readExtras(c.published) : null,
  }
}

/** Черновик/публикация описания: ?content=1 (GET, PUT) и ?publish=1 (POST, только явным действием). */
async function handleContent(request: Request, url: URL, id: string, userId: string, deps: AdminProductsDeps): Promise<Response> {
  const store = deps.content
  if (!store) return jsonResponse(503, { error: 'content_unavailable' })
  const publish = url.searchParams.get('publish') === '1'
  if (request.method === 'PUT' && url.searchParams.get('extras') === '1' && !publish) return handleExtras(request, id, userId, store, deps)
  if (request.method === 'GET' && !publish) return jsonResponse(200, { content: contentView(id, await store.get(id)) })
  if (request.method === 'PUT' && !publish) {
    const body = await readLimitedJson(request)
    if (!body.ok) return jsonResponse(body.status, { error: 'bad_request' })
    const v = body.value as { doc?: unknown; rev?: unknown }
    if (!v || typeof v !== 'object' || !Number.isInteger(v.rev) || (v.rev as number) < 0) return jsonResponse(400, { error: 'invalid', field: 'rev' })
    const checked = validateDescriptionDoc(v.doc)
    if (!checked.ok) return jsonResponse(400, { error: checked.error, field: 'doc' })
    const doc = canonicalDoc(checked.value)
    const cur = await store.get(id)
    const content = docToContent(doc, cur?.draft ?? null)
    const r = await store.saveDraft(id, content, docToPlainText(doc).slice(0, 20000), v.rev as number, userId, deps.now().toISOString())
    if (!r.ok) return jsonResponse(409, { error: 'conflict', content: contentView(id, r.conflict) })
    deps.log.info('admin_product_draft_saved')
    return jsonResponse(200, { content: contentView(id, r.value) })
  }
  if (request.method === 'POST' && publish) {
    const body = await readLimitedJson(request)
    if (!body.ok) return jsonResponse(body.status, { error: 'bad_request' })
    const rev = (body.value as { rev?: unknown } | null)?.rev
    const cur = await store.get(id)
    if (!cur) return jsonResponse(404, { error: 'no_draft' })
    // Публикуется ровно то, что админ видит: устаревшая ревизия — конфликт, а не «чужой» черновик.
    if (rev !== cur.draftRev) return jsonResponse(409, { error: 'conflict', content: contentView(id, cur) })
    const r = await store.publish(id, userId, deps.now().toISOString())
    if (!r) return jsonResponse(404, { error: 'no_draft' })
    deps.log.info('admin_product_content_published')
    return jsonResponse(200, { content: contentView(id, r) })
  }
  return jsonResponse(405, { error: 'method_not_allowed' }, { allow: 'GET, PUT, POST' })
}

function mediaResolver(media: MediaStore | null | undefined): MediaResolver {
  return async (mediaId, want) => {
    if (!media) return { ok: false, error: 'media_unavailable' }
    const m = await media.get(mediaId)
    if (!m || m.deletedAt) return { ok: false, error: 'media_not_found' }
    if (m.kind !== want) return { ok: false, error: 'media_wrong_kind' }
    if (m.status !== 'ready') return { ok: false, error: 'media_not_ready' }
    if (want === 'video') return { ok: true, src: m.blobUrl, width: m.width ?? 0, height: m.height ?? 0, mime: m.mime }
    const img = mediaToProductImage(m)
    if (!img) return { ok: false, error: 'media_not_ready' }
    return { ok: true, src: img.src, ...(img.srcSet ? { srcSet: img.srcSet } : {}), width: img.width, height: img.height, mime: m.mime }
  }
}

/** PUT ?content=1&extras=1 {blocks, showVideos, videos, rev}: дополнительные блоки и видео в черновик (без публикации). */
async function handleExtras(request: Request, id: string, userId: string, store: ProductContentStore, deps: AdminProductsDeps): Promise<Response> {
  const body = await readLimitedJson(request)
  if (!body.ok) return jsonResponse(body.status, { error: 'bad_request' })
  const v = body.value as { rev?: unknown } | null
  if (!v || typeof v !== 'object' || !Number.isInteger(v.rev) || (v.rev as number) < 0) return jsonResponse(400, { error: 'invalid', field: 'rev' })
  const checked = await checkExtrasInput(v, mediaResolver(deps.media))
  if (!checked.ok) return jsonResponse(400, { error: checked.error, field: checked.field })
  const cur = await store.get(id)
  // Первого черновика ещё нет — берём текущее описание товара, чтобы публикация не стёрла текст.
  const base = cur?.draft ?? docToContent(canonicalDoc(await currentDoc(id, deps)), null)
  const content = applyExtras(base, checked.value)
  const doc = contentToDoc(content)
  const text = doc ? docToPlainText(doc).slice(0, 20000) : ''
  const r = await store.saveDraft(id, content, text, v.rev as number, userId, deps.now().toISOString())
  if (!r.ok) return jsonResponse(409, { error: 'conflict', content: contentView(id, r.conflict) })
  deps.log.info('admin_product_draft_saved', { kind: 'extras' })
  return jsonResponse(200, { content: contentView(id, r.value) })
}

async function currentDoc(id: string, deps: AdminProductsDeps) {
  const base = productById(id)
  let stored: StoredProductOverride | null
  try {
    stored = deps.overrides ? await deps.overrides.get(id) : null
  } catch {
    stored = null
  }
  return toEditableDoc(base ? mergeProduct(base, stored?.overrides).description : null)
}

function extractId(url: URL): string | null {
  const raw = url.searchParams.get('id') ?? (() => {
    const parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean)
    return parts.length >= 4 && parts[0] === 'api' && parts[1] === 'admin' && parts[2] === 'products' ? parts[3]! : null
  })()
  return raw
}

function listItem(id: string, stored: StoredProductOverride | undefined) {
  const base = productById(id)!
  const merged = mergeProduct(base, stored?.overrides)
  const pub = toPublicProductData(merged)
  return {
    id: base.id,
    slug: base.slug,
    brand: brandName(base.brandId),
    category: base.category,
    name: pub.name,
    pack: pub.pack,
    price: pub.price,
    image: pub.image,
    overridden: stored ? Object.keys(stored.overrides) : [],
    updatedAt: stored?.updatedAt ?? null,
  }
}

function detail(id: string, stored: StoredProductOverride | null) {
  const base = productById(id)!
  return {
    product: {
      ...listItem(id, stored ?? undefined),
      merged: toPublicProductData(mergeProduct(base, stored?.overrides)),
      base: toPublicProductData(base),
    },
  }
}

async function readBinary(request: Request): Promise<{ ok: true; bytes: Buffer } | { ok: false; status: number; error: string }> {
  const declared = request.headers.get('content-length')
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > UPLOAD_MAX_BYTES)) {
    return { ok: false, status: 413, error: 'file_too_large' }
  }
  if (!request.body) return { ok: false, status: 400, error: 'empty_file' }
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > UPLOAD_MAX_BYTES) {
      await reader.cancel()
      return { ok: false, status: 413, error: 'file_too_large' }
    }
    chunks.push(value)
  }
  return { ok: true, bytes: Buffer.concat(chunks) }
}

const ALLOW = 'GET, PATCH, POST, PUT'

export async function handleAdminProductsRequest(request: Request, deps: AdminProductsDeps): Promise<Response> {
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return jsonResponse(400, { error: 'bad_request' })
  }
  const auth = authorizeAdmin(request, deps)
  if (!auth.ok) return jsonResponse(auth.status, { error: auth.error })

  const id = extractId(url)
  if (id !== null && !isKnownProductId(id)) return jsonResponse(404, { error: 'not_found' })

  try {
    if (request.method === 'GET' && !id) {
      let map = new Map<string, StoredProductOverride>()
      let available = true
      if (deps.overrides) {
        try {
          map = await deps.overrides.list()
        } catch (error) {
          if (!(error instanceof ProductOverridesUnavailableError)) throw error
          available = false
        }
      } else available = false
      const q = (url.searchParams.get('q') ?? '').trim().toLowerCase().slice(0, 100)
      const items = PRODUCTS.map((p) => listItem(p.id, map.get(p.id))).filter(
        (p) => !q || `${p.name} ${p.brand} ${p.pack ?? ''}`.toLowerCase().includes(q),
      )
      return jsonResponse(200, { editable: available, total: items.length, products: items })
    }
    if (!id) return jsonResponse(405, { error: 'method_not_allowed' }, { allow: ALLOW })
    if (url.searchParams.get('content') === '1' || url.searchParams.get('publish') === '1') {
      return await handleContent(request, url, id, auth.userId, deps)
    }

    if (request.method === 'GET') {
      let stored: StoredProductOverride | null = null
      let editable = !!deps.overrides
      if (deps.overrides) {
        try {
          stored = await deps.overrides.get(id)
        } catch (error) {
          if (!(error instanceof ProductOverridesUnavailableError)) throw error
          editable = false
        }
      }
      return jsonResponse(200, { editable, ...detail(id, stored) })
    }

    if (request.method === 'PATCH') {
      if (!deps.overrides) return jsonResponse(503, { error: 'overrides_unavailable' })
      const body = await readLimitedJson(request)
      if (!body.ok) return jsonResponse(body.status, { error: 'bad_request' })
      let failure: { error: string; field?: string } | null = null
      const stored = await deps.overrides.update(id, auth.userId, deps.now().toISOString(), (current) => {
        const r = applyProductPatch(current, body.value)
        if (!r.ok || !r.override) {
          failure = { error: r.error ?? 'invalid', field: r.field }
          return null
        }
        return r.override
      })
      if (!stored) return jsonResponse(400, failure ?? { error: 'invalid' })
      deps.log.info('admin_product_edited', { kind: Object.keys((body.value as { set?: object }).set ?? {}).join(',') || 'reset' })
      return jsonResponse(200, { editable: true, ...detail(id, stored) })
    }

    if (request.method === 'POST' && url.searchParams.get('upload') === '1') {
      if (!deps.overrides) return jsonResponse(503, { error: 'overrides_unavailable' })
      if (!deps.encoder || !deps.putBlob) return jsonResponse(503, { error: 'storage_not_configured' })
      // Таблица должна существовать, иначе загруженный файл некуда будет сохранить.
      await deps.overrides.get(id)
      const ct = (request.headers.get('content-type') ?? '').toLowerCase().split(';')[0]!.trim()
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(ct)) {
        return jsonResponse(415, { error: 'unsupported_image_type' })
      }
      const body = await readBinary(request)
      if (!body.ok) return jsonResponse(body.status, { error: body.error })
      const result = await processProductImage(id, body.bytes, deps.encoder, deps.putBlob)
      if (!result.ok) return jsonResponse(result.status, { error: result.error })
      deps.log.info('admin_product_image_uploaded')
      return jsonResponse(201, { image: toPublicProductData({ ...productById(id)!, image: result.image }).image, blob: result.image })
    }

    return jsonResponse(405, { error: 'method_not_allowed' }, { allow: ALLOW })
  } catch (error) {
    if (error instanceof ProductContentUnavailableError) {
      deps.log.error('product_content_unavailable', { errorClass: 'content_table_missing' })
      return jsonResponse(503, { error: 'content_unavailable' })
    }
    if (error instanceof ProductOverridesUnavailableError) {
      deps.log.error('products_overrides_unavailable', { errorClass: 'overrides_table_missing' })
      return jsonResponse(503, { error: 'overrides_unavailable' })
    }
    deps.log.error('storage_failed', { errorClass: errorClass(error) })
    return jsonResponse(503, { error: 'unavailable' })
  }
}
