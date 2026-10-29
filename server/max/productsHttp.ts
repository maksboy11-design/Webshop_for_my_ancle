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
import { UPLOAD_MAX_BYTES, processProductImage, type BlobPutter, type ImageEncoder } from './productImages'

export const PUBLIC_PRODUCTS_CACHE = 'public, max-age=0, s-maxage=30, stale-while-revalidate=300'

function errorClass(error: unknown): string {
  if (error instanceof ProductOverridesUnavailableError) return 'overrides_table_missing'
  return error instanceof Error ? error.name : 'unknown'
}

export interface PublicProductsDeps {
  overrides: ProductOverrideStore | null
  log: Log
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
  const list = (changedOnly ? PRODUCTS.filter((p) => overrides.has(p.id)) : PRODUCTS).map((p) =>
    toPublicProductData(mergeProduct(p, overrides.get(p.id))),
  )
  // Кешируем только успешный ответ из БД; статический резерв — коротко, чтобы быстро подхватить восстановление.
  const cache = source === 'db' ? PUBLIC_PRODUCTS_CACHE : 'public, max-age=0, s-maxage=5'
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
    'cache-control': cache,
  })
  return new Response(JSON.stringify({ source, products: list }), { status: 200, headers })
}

export interface AdminProductsDeps extends AdminAuthDeps {
  overrides: ProductOverrideStore | null
  log: Log
  encoder: ImageEncoder | null
  putBlob: BlobPutter | null
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

const ALLOW = 'GET, PATCH, POST'

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
    if (error instanceof ProductOverridesUnavailableError) {
      deps.log.error('products_overrides_unavailable', { errorClass: 'overrides_table_missing' })
      return jsonResponse(503, { error: 'overrides_unavailable' })
    }
    deps.log.error('storage_failed', { errorClass: errorClass(error) })
    return jsonResponse(503, { error: 'unavailable' })
  }
}
