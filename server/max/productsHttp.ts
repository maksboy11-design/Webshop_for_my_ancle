/**
 * Товары: публичный GET /api/products и защищённый /api/admin/products.
 * Публичный ответ — только объединённые публичные поля; без таблицы/БД — статический каталог (сайт не ломается).
 * Этап 5: bulk по id, дубликат, статусы, версии, корзина, черновик карточки в product_content.meta.
 */
import { PRODUCTS, brandName, productById, type Product } from '../../src/data/products'
import { mergeProduct, toPublicProductData, type ProductOverride } from '../../src/cms/productMerge'
import { authorizeAdmin, type AdminAuthDeps } from './adminAuth'
import { jsonResponse, readLimitedJson } from './http'
import type { Log } from './logger'
import { ProductOverridesUnavailableError, type ProductOverrideStore, type StoredProductOverride } from './productOverrideStore'
import { applyProductPatch, isKnownProductId, isProductIdFormat } from './productOverrides'
import { publicProductFromEntry, type EntryStore } from './cmsEntries'
import { ProductContentUnavailableError, type ProductContentStore, type StoredProductContent } from './productContentStore'
import { contentToDoc, docToContent } from '../../src/cms/contentDoc'
import { canonicalDoc, docToPlainText, toEditableDoc, validateDescriptionDoc } from '../../src/cms/descriptionDoc'
import { MediaUnavailableError, type GalleryRole, type MediaStore } from './mediaStore'
import { mediaToProductImage, productDocumentsFromLinks, productImagesFromLinks } from './mediaImages'
import type { ProductDocument, ProductExtras } from '../../src/data/products'
import { applyExtras, checkExtrasInput, publicExtras, readExtras, type MediaResolver } from '../../src/cms/richBlocks'
import { UPLOAD_MAX_BYTES, processProductImage, type BlobPutter, type ImageEncoder } from './productImages'
import {
  BULK_MAX_IDS,
  applyCardPatch,
  cardToOverridePatch,
  duplicateProductId,
  isBulkOp,
  isBrandId,
  isCategory,
  isProductStatus,
  readCardFields,
  readDuplicateParts,
  type BulkOp,
  type CardFields,
  type ProductStatus,
} from '../../src/cms/productCard'
import { emptyContent, type ContentMeta, type ProductContent } from '../../src/cms/blocks'
import { BRAND_LABELS } from '../../src/content/copy'

export const PUBLIC_PRODUCTS_CACHE = 'public, max-age=0, s-maxage=30, stale-while-revalidate=300'

/** Срок хранения в корзине (дней). Очистка — только по запросу админа; cron на Hobby не добавляем (11/12 слотов). */
export const TRASH_RETENTION_DAYS = 30

function errorClass(error: unknown): string {
  if (error instanceof ProductOverridesUnavailableError) return 'overrides_table_missing'
  return error instanceof Error ? error.name : 'unknown'
}

export interface PublicProductsDeps {
  overrides: ProductOverrideStore | null
  log: Log
  entries?: EntryStore | null
  content?: ProductContentStore | null
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
  const hidden = new Set<string>()
  if (deps.content) {
    try {
      for (const [id, published] of await deps.content.listPublished()) {
        const card = readCardFields(published.meta)
        const patch = cardToOverridePatch(card)
        overrides.set(id, { ...(overrides.get(id) ?? {}), ...patch, description: contentToDoc(published) })
        const x = publicExtras(published)
        if (x.blocks.length || x.videos.length) extras.set(id, x)
      }
      const h = await deps.content.listHiddenIds()
      for (const id of h.deleted) hidden.add(id)
      for (const id of h.archived) hidden.add(id)
    } catch (error) {
      deps.log.error('product_content_unavailable', {
        errorClass: error instanceof ProductContentUnavailableError ? 'content_table_missing' : errorClass(error),
      })
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
  const list = (changedOnly ? PRODUCTS.filter((p) => overrides.has(p.id) || documents.has(p.id) || extras.has(p.id)) : PRODUCTS)
    .filter((p) => !hidden.has(p.id))
    .map((p) => toPublicProductData({ ...mergeProduct(p, overrides.get(p.id)), documents: documents.get(p.id), extras: extras.get(p.id) }))
  let added: NonNullable<ReturnType<typeof publicProductFromEntry>>[] = []
  if (deps.entries) {
    try {
      added = (await deps.entries.list('product', 'published'))
        .map(publicProductFromEntry)
        .filter((p): p is NonNullable<typeof p> => p !== null && !hidden.has(p.id))
    } catch {
      deps.log.error('product_entries_unavailable')
    }
  }
  // Дубликаты CMS (есть published content, нет в статическом каталоге) — в added.
  if (deps.content) {
    try {
      for (const [id, published] of await deps.content.listPublished()) {
        if (productById(id) || hidden.has(id) || added.some((a) => a.id === id)) continue
        const base = syntheticProduct(id, readCardFields(published.meta))
        const merged = mergeProduct(base, overrides.get(id))
        added.push(toPublicProductData({ ...merged, documents: documents.get(id), extras: extras.get(id) }) as (typeof added)[number])
      }
    } catch {
      /* уже залогировано */
    }
  }
  const cache = source === 'db' ? PUBLIC_PRODUCTS_CACHE : 'public, max-age=0, s-maxage=5'
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
    'cache-control': cache,
  })
  return new Response(JSON.stringify(added.length ? { source, products: list, added } : { source, products: list }), {
    status: 200,
    headers,
  })
}

export interface AdminProductsDeps extends AdminAuthDeps {
  overrides: ProductOverrideStore | null
  log: Log
  encoder: ImageEncoder | null
  putBlob: BlobPutter | null
  content?: ProductContentStore | null
  media?: MediaStore | null
}

function contentView(id: string, c: StoredProductContent | null) {
  const draftCard = c ? readCardFields(c.draft.meta) : {}
  const publishedCard = c?.published ? readCardFields(c.published.meta) : null
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
    deletedAt: c?.deletedAt ?? null,
    draftCard,
    publishedCard,
    draftExtras: readExtras(c?.draft),
    publishedExtras: c?.published ? readExtras(c.published) : null,
  }
}

function syntheticProduct(id: string, card: CardFields): Product {
  const brandId = card.brandId && isBrandId(card.brandId) ? card.brandId : ('halos' as keyof typeof BRAND_LABELS)
  const category = card.category && isCategory(card.category) ? card.category : 'supplements'
  const image = card.image ?? { src: '/products/catalog/placeholder.webp', width: 600, height: 600 }
  return {
    id,
    slug: id,
    brandId,
    name: card.name ?? id,
    pack: card.pack ?? null,
    category,
    form: null,
    kind: card.kind ?? 'goods',
    image,
    gallery: card.gallery ?? [],
    priceListId: null,
    price: card.price ?? null,
    description: null,
    ...(card.tags ? { tags: card.tags } : {}),
    ...(card.badges ? { badges: card.badges } : {}),
  }
}

async function resolveBase(id: string, deps: AdminProductsDeps): Promise<Product | null> {
  const cat = productById(id)
  if (cat) return cat
  if (!deps.content) return null
  try {
    const c = await deps.content.get(id, { includeDeleted: true })
    if (!c) return null
    return syntheticProduct(id, readCardFields(c.draft.meta))
  } catch {
    return null
  }
}

/** Черновик/публикация описания: ?content=1 (GET, PUT) и ?publish=1 (POST, только явным действием). */
async function handleContent(request: Request, url: URL, id: string, userId: string, deps: AdminProductsDeps): Promise<Response> {
  const store = deps.content
  if (!store) return jsonResponse(503, { error: 'content_unavailable' })
  const publish = url.searchParams.get('publish') === '1'
  if (request.method === 'PUT' && url.searchParams.get('extras') === '1' && !publish) return handleExtras(request, id, userId, store, deps)
  if (request.method === 'PUT' && url.searchParams.get('card') === '1' && !publish) return handleCardDraft(request, id, userId, store, deps)
  if (request.method === 'GET' && !publish) {
    const includeDeleted = url.searchParams.get('trash') === '1'
    return jsonResponse(200, { content: contentView(id, await store.get(id, { includeDeleted })) })
  }
  if (request.method === 'PUT' && !publish) {
    const body = await readLimitedJson(request)
    if (!body.ok) return jsonResponse(body.status, { error: 'bad_request' })
    const v = body.value as { doc?: unknown; rev?: unknown }
    if (!v || typeof v !== 'object' || !Number.isInteger(v.rev) || (v.rev as number) < 0)
      return jsonResponse(400, { error: 'invalid', field: 'rev' })
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
    if (rev !== cur.draftRev) return jsonResponse(409, { error: 'conflict', content: contentView(id, cur) })
    const r = await store.publish(id, userId, deps.now().toISOString())
    if (!r) return jsonResponse(404, { error: 'no_draft' })
    // Карточка из published.meta → overrides (публичный каталог).
    await applyPublishedCardToOverrides(id, r, userId, deps)
    deps.log.info('admin_product_content_published')
    return jsonResponse(200, { content: contentView(id, r) })
  }
  return jsonResponse(405, { error: 'method_not_allowed' }, { allow: 'GET, PUT, POST' })
}

async function applyPublishedCardToOverrides(id: string, stored: StoredProductContent, userId: string, deps: AdminProductsDeps) {
  if (!deps.overrides || !stored.published) return
  const patch = cardToOverridePatch(readCardFields(stored.published.meta))
  if (!Object.keys(patch).length) return
  try {
    await deps.overrides.update(id, userId, deps.now().toISOString(), (current) => {
      const r = applyProductPatch(current, { set: patch })
      return r.ok && r.override ? r.override : current
    })
  } catch (error) {
    if (!(error instanceof ProductOverridesUnavailableError)) throw error
  }
}

async function handleCardDraft(
  request: Request,
  id: string,
  userId: string,
  store: ProductContentStore,
  deps: AdminProductsDeps,
): Promise<Response> {
  const body = await readLimitedJson(request)
  if (!body.ok) return jsonResponse(body.status, { error: 'bad_request' })
  const v = body.value as { rev?: unknown; card?: unknown } | null
  if (!v || typeof v !== 'object' || !Number.isInteger(v.rev) || (v.rev as number) < 0)
    return jsonResponse(400, { error: 'invalid', field: 'rev' })
  const patch = readCardFields(v.card as ContentMeta | null | undefined)
  // readCardFields soft; reject empty unknown object with bad types via re-check
  if (v.card !== undefined && (v.card === null || typeof v.card !== 'object' || Array.isArray(v.card))) {
    return jsonResponse(400, { error: 'invalid', field: 'card' })
  }
  const cur = await store.get(id)
  const base = cur?.draft ?? emptyContent()
  // Если карточки ещё нет — подтянуть имя/цену из каталога, чтобы не публиковать пустоту.
  let seed = base
  if (!cur) {
    const cat = productById(id)
    if (cat) {
      seed = {
        ...emptyContent(),
        meta: applyCardPatch(
          {},
          {
            name: cat.name,
            pack: cat.pack,
            price: cat.price,
            category: cat.category,
            brandId: cat.brandId,
            kind: cat.kind,
            image: cat.image,
            gallery: cat.gallery,
          },
        ),
      }
    }
  }
  const content: ProductContent = { ...seed, meta: applyCardPatch(seed.meta, patch) }
  const doc = contentToDoc(content)
  const text = doc ? docToPlainText(doc).slice(0, 20000) : ''
  const r = await store.saveDraft(id, content, text, v.rev as number, userId, deps.now().toISOString())
  if (!r.ok) return jsonResponse(409, { error: 'conflict', content: contentView(id, r.conflict) })
  deps.log.info('admin_product_draft_saved', { kind: 'card' })
  return jsonResponse(200, { content: contentView(id, r.value) })
}

export function mediaResolver(media: MediaStore | null | undefined): MediaResolver {
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

async function handleExtras(
  request: Request,
  id: string,
  userId: string,
  store: ProductContentStore,
  deps: AdminProductsDeps,
): Promise<Response> {
  const body = await readLimitedJson(request)
  if (!body.ok) return jsonResponse(body.status, { error: 'bad_request' })
  const v = body.value as { rev?: unknown } | null
  if (!v || typeof v !== 'object' || !Number.isInteger(v.rev) || (v.rev as number) < 0)
    return jsonResponse(400, { error: 'invalid', field: 'rev' })
  const checked = await checkExtrasInput(v, mediaResolver(deps.media))
  if (!checked.ok) return jsonResponse(400, { error: checked.error, field: checked.field })
  const cur = await store.get(id)
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
  const base = await resolveBase(id, deps)
  let stored: StoredProductOverride | null
  try {
    stored = deps.overrides ? await deps.overrides.get(id) : null
  } catch {
    stored = null
  }
  return toEditableDoc(base ? mergeProduct(base, stored?.overrides).description : null)
}

function extractId(url: URL): string | null {
  const raw =
    url.searchParams.get('id') ??
    (() => {
      const parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean)
      return parts.length >= 4 && parts[0] === 'api' && parts[1] === 'admin' && parts[2] === 'products' ? parts[3]! : null
    })()
  return raw
}

function listItem(
  base: Product,
  stored: StoredProductOverride | undefined,
  meta?: { status?: ProductStatus | null; deletedAt?: string | null; draftRev?: number },
) {
  const merged = mergeProduct(base, stored?.overrides)
  const pub = toPublicProductData(merged)
  return {
    id: base.id,
    slug: base.slug,
    brand: brandName(base.brandId),
    category: merged.category,
    name: pub.name,
    pack: pub.pack,
    price: pub.price,
    image: pub.image,
    overridden: stored ? Object.keys(stored.overrides) : [],
    updatedAt: stored?.updatedAt ?? null,
    status: meta?.status ?? null,
    deletedAt: meta?.deletedAt ?? null,
    draftRev: meta?.draftRev ?? 0,
    tags: merged.tags ?? [],
    badges: merged.badges ?? [],
    brandId: merged.brandId,
  }
}

async function detailPayload(id: string, stored: StoredProductOverride | null, deps: AdminProductsDeps) {
  const base = await resolveBase(id, deps)
  if (!base) return null
  let content: StoredProductContent | null = null
  if (deps.content) {
    try {
      content = await deps.content.get(id, { includeDeleted: true })
    } catch {
      content = null
    }
  }
  return {
    product: {
      ...listItem(base, stored ?? undefined, {
        status: content?.status ?? null,
        deletedAt: content?.deletedAt ?? null,
        draftRev: content?.draftRev ?? 0,
      }),
      merged: toPublicProductData(mergeProduct(base, stored?.overrides)),
      base: toPublicProductData(base),
      content: contentView(id, content),
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

const ALLOW = 'GET, PATCH, POST, PUT, DELETE'

async function handleBulk(request: Request, userId: string, deps: AdminProductsDeps): Promise<Response> {
  if (!deps.content) return jsonResponse(503, { error: 'content_unavailable' })
  const body = await readLimitedJson(request)
  if (!body.ok) return jsonResponse(body.status, { error: 'bad_request' })
  const v = body.value as {
    ids?: unknown
    op?: unknown
    status?: unknown
    category?: unknown
    brandId?: unknown
    tags?: unknown
    badges?: unknown
  } | null
  if (!v || typeof v !== 'object') return jsonResponse(400, { error: 'invalid_body' })
  if (!Array.isArray(v.ids) || !v.ids.length || v.ids.length > BULK_MAX_IDS) return jsonResponse(400, { error: 'ids_invalid' })
  const ids = [...new Set(v.ids.map(String))].filter(isProductIdFormat)
  if (ids.length !== v.ids.length && ids.length === 0) return jsonResponse(400, { error: 'ids_invalid' })
  if (!isBulkOp(v.op)) return jsonResponse(400, { error: 'op_invalid' })
  const op: BulkOp = v.op
  const nowIso = deps.now().toISOString()

  const result = await deps.content.bulk(
    ids,
    async (id, cur) => {
      if (op === 'trash') return { trash: true }
      if (op === 'restore') return cur?.deletedAt ? { restore: true } : { skip: 'not_trashed' }
      if (cur?.deletedAt) return { skip: 'trashed' }
      if (op === 'archive') return { status: 'archived' }
      if (op === 'publish') return { publish: true }
      if (op === 'unpublish') return { unpublish: true }
      if (op === 'set_status') {
        if (!isProductStatus(v.status) || v.status === 'published') return { error: 'status_invalid' }
        return { status: v.status }
      }
      // card field ops — правят draft.meta
      const draft =
        cur?.draft ??
        (() => {
          const cat = productById(id)
          if (!cat) return emptyContent()
          return {
            ...emptyContent(),
            meta: applyCardPatch(
              {},
              {
                name: cat.name,
                pack: cat.pack,
                price: cat.price,
                category: cat.category,
                brandId: cat.brandId,
                kind: cat.kind,
              },
            ),
          }
        })()
      const card = readCardFields(draft.meta)
      if (op === 'set_category') {
        if (!isCategory(v.category)) return { error: 'category_invalid' }
        return { draft: { ...draft, meta: applyCardPatch(draft.meta, { category: v.category }) } }
      }
      if (op === 'set_brand') {
        if (!isBrandId(v.brandId)) return { error: 'brand_invalid' }
        return { draft: { ...draft, meta: applyCardPatch(draft.meta, { brandId: v.brandId }) } }
      }
      if (op === 'add_tags' || op === 'remove_tags') {
        if (!Array.isArray(v.tags)) return { error: 'tags_invalid' }
        const incoming = v.tags
          .filter((t): t is string => typeof t === 'string')
          .map((t) => t.trim())
          .filter(Boolean)
        const curTags = card.tags ?? []
        const next =
          op === 'add_tags'
            ? [...new Set([...curTags, ...incoming])].slice(0, 30)
            : curTags.filter((t) => !incoming.map((x) => x.toLowerCase()).includes(t.toLowerCase()))
        return { draft: { ...draft, meta: applyCardPatch(draft.meta, { tags: next }) } }
      }
      if (op === 'set_badges') {
        if (!Array.isArray(v.badges)) return { error: 'badges_invalid' }
        const badges = v.badges
          .filter((t): t is string => typeof t === 'string')
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 12)
        return { draft: { ...draft, meta: applyCardPatch(draft.meta, { badges }) } }
      }
      return { error: 'op_invalid' }
    },
    userId,
    nowIso,
  )

  // После bulk publish — накатить карточку в overrides по успешным id.
  if (op === 'publish' && deps.overrides) {
    for (const id of result.ok) {
      try {
        const c = await deps.content.get(id)
        if (c) await applyPublishedCardToOverrides(id, c, userId, deps)
      } catch {
        /* ignore per-id */
      }
    }
  }

  deps.log.info('admin_product_bulk', { kind: op })
  return jsonResponse(200, { ok: result.ok, failed: result.failed, total: ids.length })
}

async function handleDuplicate(request: Request, sourceId: string, userId: string, deps: AdminProductsDeps): Promise<Response> {
  if (!deps.content) return jsonResponse(503, { error: 'content_unavailable' })
  const body = await readLimitedJson(request)
  if (!body.ok) return jsonResponse(body.status, { error: 'bad_request' })
  const parts = readDuplicateParts((body.value as { parts?: unknown } | null)?.parts)
  const src = await deps.content.get(sourceId)
  const cat = productById(sourceId)
  if (!src && !cat) return jsonResponse(404, { error: 'not_found' })
  const nowIso = deps.now().toISOString()
  let targetId = duplicateProductId(sourceId)
  for (let i = 0; i < 5; i++) {
    const taken = await deps.content.get(targetId, { includeDeleted: true })
    if (!taken && !productById(targetId)) break
    targetId = duplicateProductId(sourceId)
  }
  const srcDraft = src?.draft ?? emptyContent()
  const card = parts.card
    ? readCardFields(srcDraft.meta)
    : cat
      ? { name: cat.name, pack: cat.pack, price: cat.price, category: cat.category, brandId: cat.brandId, kind: cat.kind }
      : {}
  const name = typeof card.name === 'string' ? `${card.name} (копия)` : `${sourceId} (копия)`
  let draft: ProductContent = {
    schema_version: srcDraft.schema_version,
    meta: applyCardPatch(parts.card ? { ...srcDraft.meta } : {}, { ...card, name }),
    blocks: parts.content ? srcDraft.blocks.map((b) => ({ ...b })) : [],
  }
  if (!parts.content) {
    // без блоков — но мета карточки уже есть
  }
  const r = await deps.content.duplicateContent(sourceId, targetId, draft, userId, nowIso)
  if (!r.ok) return jsonResponse(409, { error: r.error })

  if (deps.media && (parts.media || parts.documents)) {
    try {
      const links = await deps.media.productMedia(sourceId)
      if (parts.media) {
        const imgs = links
          .filter((l) => l.role === 'main' || l.role === 'gallery')
          .map((l) => ({ mediaId: l.mediaId, role: l.role as GalleryRole }))
        if (imgs.length) await deps.media.setProductMedia(targetId, imgs, 'images')
      }
      if (parts.documents) {
        const docs = links.filter((l) => l.role === 'document').map((l) => ({ mediaId: l.mediaId, role: 'document' as GalleryRole }))
        if (docs.length) await deps.media.setProductMedia(targetId, docs, 'documents')
      }
    } catch (error) {
      if (!(error instanceof MediaUnavailableError)) throw error
    }
  }

  deps.log.info('admin_product_duplicated')
  return jsonResponse(201, { id: targetId, content: contentView(targetId, r.value) })
}

async function handleVersions(request: Request, url: URL, id: string, userId: string, deps: AdminProductsDeps): Promise<Response> {
  if (!deps.content) return jsonResponse(503, { error: 'content_unavailable' })
  const restoreRev = url.searchParams.get('restoreVersion')
  if (request.method === 'POST' && restoreRev) {
    const rev = Number(restoreRev)
    if (!Number.isInteger(rev) || rev < 1) return jsonResponse(400, { error: 'rev_invalid' })
    const r = await deps.content.restoreVersion(id, rev, userId, deps.now().toISOString())
    if (!r.ok) return jsonResponse(r.error === 'version_missing' ? 404 : 400, { error: r.error })
    deps.log.info('admin_product_version_restored')
    return jsonResponse(200, { content: contentView(id, r.value) })
  }
  const one = url.searchParams.get('version')
  if (request.method === 'GET' && one) {
    const rev = Number(one)
    if (!Number.isInteger(rev) || rev < 1) return jsonResponse(400, { error: 'rev_invalid' })
    const snap = await deps.content.version(id, rev)
    if (!snap) return jsonResponse(404, { error: 'not_found' })
    return jsonResponse(200, { version: snap })
  }
  if (request.method === 'GET' && url.searchParams.get('versions') === '1') {
    return jsonResponse(200, { versions: await deps.content.versions(id) })
  }
  return jsonResponse(405, { error: 'method_not_allowed' })
}

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
  if (id !== null && !isProductIdFormat(id)) return jsonResponse(404, { error: 'not_found' })

  try {
    // Пакетные операции — без id в path.
    if (request.method === 'POST' && url.searchParams.get('bulk') === '1' && !id) {
      return await handleBulk(request, auth.userId, deps)
    }
    if (request.method === 'POST' && url.searchParams.get('purgeExpired') === '1' && !id) {
      if (!deps.content) return jsonResponse(503, { error: 'content_unavailable' })
      const body = await readLimitedJson(request)
      if (!body.ok) return jsonResponse(body.status, { error: 'bad_request' })
      const days = Number((body.value as { keepDays?: unknown } | null)?.keepDays ?? TRASH_RETENTION_DAYS)
      if (!Number.isInteger(days) || days < 1 || days > 365) return jsonResponse(400, { error: 'keep_days_invalid' })
      const r = await deps.content.purgeExpired(days, deps.now().toISOString())
      deps.log.info('admin_product_purge_expired', { kind: String(r.purged.length) })
      return jsonResponse(200, { purged: r.purged, keepDays: days })
    }

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
      const trash = url.searchParams.get('trash') === '1'
      const statusFilter = url.searchParams.get('status')

      // Базовый список: каталог + id из content (дубликаты).
      const ids = new Set(PRODUCTS.map((p) => p.id))
      let summaries = new Map<
        string,
        {
          status: ProductStatus
          deletedAt: string | null
          updatedAt: string
          publishedAt: string | null
          draftRev: number
          publishedRev: number | null
        }
      >()
      if (deps.content) {
        try {
          for (const row of await deps.content.listIds()) {
            ids.add(row.productId)
            summaries.set(row.productId, {
              status: row.status,
              deletedAt: row.deletedAt,
              updatedAt: row.updatedAt,
              publishedAt: null,
              draftRev: row.draftRev,
              publishedRev: null,
            })
          }
        } catch (error) {
          if (!(error instanceof ProductContentUnavailableError)) throw error
        }
      }

      const items = []
      for (const pid of ids) {
        const sum = summaries.get(pid)
        const isTrash = !!sum?.deletedAt
        if (trash !== isTrash) continue
        if (statusFilter && sum?.status !== statusFilter) continue
        const base = productById(pid) ?? syntheticProduct(pid, {})
        const item = listItem(base, map.get(pid), {
          status: sum?.status ?? null,
          deletedAt: sum?.deletedAt ?? null,
          draftRev: sum?.draftRev ?? 0,
        })
        if (q && !`${item.name} ${item.brand} ${item.pack ?? ''} ${item.tags.join(' ')}`.toLowerCase().includes(q)) continue
        items.push(item)
      }
      items.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
      return jsonResponse(200, {
        editable: available,
        total: items.length,
        products: items,
        trashRetentionDays: TRASH_RETENTION_DAYS,
        cronCleanup: false,
      })
    }

    if (!id) return jsonResponse(405, { error: 'method_not_allowed' }, { allow: ALLOW })

    if (request.method === 'POST' && url.searchParams.get('duplicate') === '1') {
      return await handleDuplicate(request, id, auth.userId, deps)
    }

    if (url.searchParams.get('versions') === '1' || url.searchParams.get('version') || url.searchParams.get('restoreVersion')) {
      return await handleVersions(request, url, id, auth.userId, deps)
    }

    if (url.searchParams.get('content') === '1' || url.searchParams.get('publish') === '1') {
      // Для content допускаем id каталога или уже существующий content id
      if (!isKnownProductId(id) && deps.content) {
        const exists = await deps.content.get(id, { includeDeleted: true })
        if (!exists && request.method === 'GET') return jsonResponse(404, { error: 'not_found' })
        // PUT/POST для нового id каталога — isKnownProductId; для copy-* разрешаем если exists
        if (!exists && !isKnownProductId(id) && request.method !== 'PUT' && request.method !== 'POST') {
          return jsonResponse(404, { error: 'not_found' })
        }
      } else if (!isKnownProductId(id) && !(await resolveBase(id, deps))) {
        return jsonResponse(404, { error: 'not_found' })
      }
      return await handleContent(request, url, id, auth.userId, deps)
    }

    if (request.method === 'POST' && url.searchParams.get('status') === '1') {
      if (!deps.content) return jsonResponse(503, { error: 'content_unavailable' })
      const body = await readLimitedJson(request)
      if (!body.ok) return jsonResponse(body.status, { error: 'bad_request' })
      const st = (body.value as { status?: unknown } | null)?.status
      if (!isProductStatus(st) || st === 'published') return jsonResponse(400, { error: 'status_invalid' })
      const r = await deps.content.setStatus(id, st, auth.userId, deps.now().toISOString())
      if (!r.ok) return jsonResponse(400, { error: r.error })
      return jsonResponse(200, { content: contentView(id, r.value) })
    }

    if (request.method === 'POST' && url.searchParams.get('trash') === '1') {
      if (!deps.content) return jsonResponse(503, { error: 'content_unavailable' })
      const r = await deps.content.trash(id, auth.userId, deps.now().toISOString())
      if (!r.ok) return jsonResponse(400, { error: r.error })
      deps.log.info('admin_product_trashed')
      return jsonResponse(200, { content: contentView(id, r.value) })
    }

    if (request.method === 'POST' && url.searchParams.get('restore') === '1') {
      if (!deps.content) return jsonResponse(503, { error: 'content_unavailable' })
      const r = await deps.content.restore(id, auth.userId, deps.now().toISOString())
      if (!r.ok) return jsonResponse(400, { error: r.error })
      deps.log.info('admin_product_restored')
      return jsonResponse(200, { content: contentView(id, r.value) })
    }

    if (request.method === 'DELETE' && url.searchParams.get('purge') === '1') {
      if (!deps.content) return jsonResponse(503, { error: 'content_unavailable' })
      const r = await deps.content.purge(id)
      if (r !== 'ok') return jsonResponse(r === 'not_found' ? 404 : 400, { error: r })
      deps.log.info('admin_product_purged')
      return jsonResponse(200, { ok: true })
    }

    if (request.method === 'GET' && url.searchParams.get('preview') === '1') {
      // Предпросмотр неопубликованного: draft + overrides, только админ.
      const base = await resolveBase(id, deps)
      if (!base) return jsonResponse(404, { error: 'not_found' })
      let stored: StoredProductOverride | null = null
      if (deps.overrides) {
        try {
          stored = await deps.overrides.get(id)
        } catch {
          stored = null
        }
      }
      let draftOverride: ProductOverride = { ...(stored?.overrides ?? {}) }
      if (deps.content) {
        const c = await deps.content.get(id)
        if (c) {
          const card = readCardFields(c.draft.meta)
          draftOverride = { ...draftOverride, ...cardToOverridePatch(card), description: contentToDoc(c.draft) }
        }
      }
      return jsonResponse(200, {
        preview: toPublicProductData(mergeProduct(base, draftOverride)),
        unpublished: true,
      })
    }

    if (request.method === 'GET') {
      const base = await resolveBase(id, deps)
      if (!base) return jsonResponse(404, { error: 'not_found' })
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
      const payload = await detailPayload(id, stored, deps)
      if (!payload) return jsonResponse(404, { error: 'not_found' })
      return jsonResponse(200, { editable, ...payload })
    }

    if (request.method === 'PATCH') {
      if (!deps.overrides) return jsonResponse(503, { error: 'overrides_unavailable' })
      if (!isKnownProductId(id) && !(await resolveBase(id, deps))) return jsonResponse(404, { error: 'not_found' })
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
      const payload = await detailPayload(id, stored, deps)
      return jsonResponse(200, { editable: true, ...payload })
    }

    if (request.method === 'POST' && url.searchParams.get('upload') === '1') {
      if (!deps.overrides) return jsonResponse(503, { error: 'overrides_unavailable' })
      if (!deps.encoder || !deps.putBlob) return jsonResponse(503, { error: 'storage_not_configured' })
      const base = await resolveBase(id, deps)
      if (!base) return jsonResponse(404, { error: 'not_found' })
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
      return jsonResponse(201, { image: toPublicProductData({ ...base, image: result.image }).image, blob: result.image })
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
