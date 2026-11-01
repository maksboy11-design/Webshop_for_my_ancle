/**
 * Глобальный поиск CMS: товары (search_tsv + каталог) и имена файлов медиатеки.
 * Пагинация на бэкенде; фильтры category/brand/status/type/даты.
 */
import { PRODUCTS, brandName, productById, type Category, type ProductKind } from '../../src/data/products'
import { isBrandId, isCategory, isProductStatus, readCardFields, type ProductStatus } from '../../src/cms/productCard'
import type { MediaRecord, MediaStore } from './mediaStore'
import type { ProductContentStore } from './productContentStore'
import type { SqlPool } from './postgresStore'

export interface CmsSearchQuery {
  q: string
  category?: Category
  brand?: string
  status?: ProductStatus
  type?: ProductKind
  createdFrom?: string
  createdTo?: string
  updatedFrom?: string
  updatedTo?: string
  scope: 'all' | 'products' | 'media'
  page: number
  limit: number
}

export type CmsSearchHit =
  | {
      kind: 'product'
      id: string
      name: string
      brand: string
      category: string
      status: ProductStatus | null
      updatedAt: string | null
      sku: string
    }
  | {
      kind: 'media'
      id: string
      name: string
      title: string | null
      mediaKind: string
      mime: string
      status: string
      createdAt: string
    }

export interface CmsSearchResult {
  total: number
  page: number
  limit: number
  items: CmsSearchHit[]
}

const isMissing = (e: unknown) => !!e && typeof e === 'object' && (e as { code?: unknown }).code === '42P01'

export function parseCmsSearchQuery(sp: URLSearchParams): CmsSearchQuery | { error: string } {
  const q = (sp.get('q') ?? '').trim().slice(0, 120)
  const scopeRaw = sp.get('scope') ?? 'all'
  const scope = scopeRaw === 'products' || scopeRaw === 'media' || scopeRaw === 'all' ? scopeRaw : null
  if (!scope) return { error: 'scope_invalid' }
  const page = Math.max(1, Math.min(500, Number(sp.get('page') ?? 1) || 1))
  const limit = Math.max(1, Math.min(50, Number(sp.get('limit') ?? 20) || 20))
  const category = sp.get('category')
  const brand = sp.get('brand')
  const status = sp.get('status')
  const type = sp.get('type')
  const out: CmsSearchQuery = { q, scope, page, limit }
  if (category) {
    if (!isCategory(category)) return { error: 'category_invalid' }
    out.category = category
  }
  if (brand) {
    if (!isBrandId(brand)) return { error: 'brand_invalid' }
    out.brand = brand
  }
  if (status) {
    if (!isProductStatus(status)) return { error: 'status_invalid' }
    out.status = status
  }
  if (type) {
    if (type !== 'device' && type !== 'supplement' && type !== 'goods') return { error: 'type_invalid' }
    out.type = type
  }
  for (const [key, field] of [
    ['createdFrom', 'createdFrom'],
    ['createdTo', 'createdTo'],
    ['updatedFrom', 'updatedFrom'],
    ['updatedTo', 'updatedTo'],
  ] as const) {
    const v = sp.get(key)
    if (!v) continue
    const t = Date.parse(v)
    if (!Number.isFinite(t)) return { error: `${field}_invalid` }
    out[field] = new Date(t).toISOString()
  }
  return out
}

function catalogHit(
  id: string,
  status: ProductStatus | null,
  updatedAt: string | null,
  overrides?: { name?: string; brandId?: string; category?: string; kind?: string },
): CmsSearchHit {
  const base = productById(id)
  const name = overrides?.name || base?.name || id
  const brandId = (overrides?.brandId as NonNullable<typeof base>['brandId'] | undefined) || base?.brandId || 'halos'
  const category = overrides?.category || base?.category || 'supplements'
  return {
    kind: 'product',
    id,
    name,
    brand: brandName(brandId),
    category,
    status,
    updatedAt,
    sku: id,
  }
}

function mediaHit(m: MediaRecord): CmsSearchHit {
  return {
    kind: 'media',
    id: m.id,
    name: m.originalName,
    title: m.title,
    mediaKind: m.kind,
    mime: m.mime,
    status: m.status,
    createdAt: m.createdAt,
  }
}

/** Поиск без PG content (память / фолбэк): каталог + listIds + media.list. */
export async function searchCmsMemory(
  query: CmsSearchQuery,
  content: ProductContentStore | null | undefined,
  media: MediaStore | null | undefined,
): Promise<CmsSearchResult> {
  const items: CmsSearchHit[] = []
  if (query.scope !== 'media') {
    const ids = new Set(PRODUCTS.map((p) => p.id))
    const summaries = new Map<string, { status: ProductStatus; deletedAt: string | null; updatedAt: string }>()
    if (content) {
      try {
        for (const row of await content.listIds()) {
          ids.add(row.productId)
          summaries.set(row.productId, { status: row.status, deletedAt: row.deletedAt, updatedAt: row.updatedAt })
        }
      } catch {
        /* unavailable */
      }
    }
    const needle = query.q.toLowerCase()
    for (const id of ids) {
      const sum = summaries.get(id)
      if (sum?.deletedAt) continue
      if (query.status && sum?.status !== query.status) continue
      if (query.updatedFrom && sum && sum.updatedAt < query.updatedFrom) continue
      if (query.updatedTo && sum && sum.updatedAt > query.updatedTo) continue
      const base = productById(id)
      let cardName: string | undefined
      let cardCategory: string | undefined
      let cardBrand: string | undefined
      let cardKind: string | undefined
      let cardTags: string[] = []
      if (content) {
        try {
          const row = await content.get(id)
          if (row) {
            const card = readCardFields(row.draft.meta)
            cardName = card.name
            cardCategory = card.category
            cardBrand = card.brandId
            cardKind = card.kind
            cardTags = card.tags ?? []
          }
        } catch {
          /* ignore */
        }
      }
      const category = cardCategory || base?.category || 'supplements'
      const brandId = (cardBrand || base?.brandId || 'halos') as Parameters<typeof brandName>[0]
      const kind = cardKind || base?.kind || 'goods'
      const name = cardName || base?.name || id
      if (query.category && category !== query.category) continue
      if (query.brand && brandId !== query.brand) continue
      if (query.type && kind !== query.type) continue
      if (query.createdFrom || query.createdTo) {
        if (!sum && (query.createdFrom || query.createdTo)) continue
      }
      const hay = `${name} ${id} ${brandName(brandId)} ${category} ${kind} ${cardTags.join(' ')}`.toLowerCase()
      if (needle && !hay.includes(needle)) continue
      items.push(catalogHit(id, sum?.status ?? null, sum?.updatedAt ?? null, { name, brandId, category, kind }))
    }
  }
  if (query.scope !== 'products' && media) {
    try {
      const r = await media.list({
        q: query.q || undefined,
        kind: null,
        sort: 'date',
        dir: 'desc',
        offset: 0,
        limit: 500,
      })
      for (const m of r.items) {
        if (query.createdFrom && m.createdAt < query.createdFrom) continue
        if (query.createdTo && m.createdAt > query.createdTo) continue
        items.push(mediaHit(m))
      }
    } catch {
      /* unavailable */
    }
  }
  items.sort((a, b) => {
    const an = a.kind === 'product' ? a.name : a.name
    const bn = b.kind === 'product' ? b.name : b.name
    return an.localeCompare(bn, 'ru')
  })
  const total = items.length
  const start = (query.page - 1) * query.limit
  return { total, page: query.page, limit: query.limit, items: items.slice(start, start + query.limit) }
}

/** PG: search_tsv + jsonb meta filters + media ILIKE. */
export async function searchCmsPg(
  pool: SqlPool,
  query: CmsSearchQuery,
  content: ProductContentStore | null | undefined,
  media: MediaStore | null | undefined,
): Promise<CmsSearchResult> {
  // Смешанная выдача: собираем продукты и медиа отдельно, потом сливаем с пагинацией на объединённом списке.
  // Для больших объёмов — берём с запасом page*limit из каждой стороны.
  const need = query.page * query.limit
  const fetchN = Math.min(500, Math.max(need, query.limit * 3))
  const productHits: CmsSearchHit[] = []
  const mediaHits: CmsSearchHit[] = []

  if (query.scope !== 'media') {
    try {
      const client = await pool.connect()
      try {
        const where: string[] = ['deleted_at IS NULL']
        const params: unknown[] = []
        if (query.q) {
          params.push(query.q)
          where.push(`search_tsv @@ plainto_tsquery('russian', $${params.length})`)
        }
        if (query.status) {
          params.push(query.status)
          where.push(`status = $${params.length}`)
        }
        if (query.category) {
          params.push(query.category)
          where.push(`(draft #>> '{meta,category}') = $${params.length}`)
        }
        if (query.brand) {
          params.push(query.brand)
          where.push(`(draft #>> '{meta,brandId}') = $${params.length}`)
        }
        if (query.type) {
          params.push(query.type)
          where.push(`(draft #>> '{meta,kind}') = $${params.length}`)
        }
        if (query.createdFrom) {
          params.push(query.createdFrom)
          where.push(`created_at >= $${params.length}::timestamptz`)
        }
        if (query.createdTo) {
          params.push(query.createdTo)
          where.push(`created_at <= $${params.length}::timestamptz`)
        }
        if (query.updatedFrom) {
          params.push(query.updatedFrom)
          where.push(`updated_at >= $${params.length}::timestamptz`)
        }
        if (query.updatedTo) {
          params.push(query.updatedTo)
          where.push(`updated_at <= $${params.length}::timestamptz`)
        }
        const w = where.join(' AND ')
        params.push(fetchN)
        const r = await client.query<{ product_id: string; status: string; updated_at: string | Date; meta: unknown }>(
          `SELECT product_id, status, updated_at, draft->'meta' AS meta
           FROM product_content WHERE ${w}
           ORDER BY updated_at DESC
           LIMIT $${params.length}`,
          params,
        )
        const seen = new Set<string>()
        for (const row of r.rows) {
          seen.add(row.product_id)
          const meta = row.meta && typeof row.meta === 'object' ? (row.meta as Record<string, unknown>) : {}
          productHits.push(
            catalogHit(row.product_id, isProductStatus(row.status) ? row.status : null, new Date(row.updated_at).toISOString(), {
              name: typeof meta.name === 'string' ? meta.name : undefined,
              brandId: typeof meta.brandId === 'string' ? meta.brandId : undefined,
              category: typeof meta.category === 'string' ? meta.category : undefined,
              kind: typeof meta.kind === 'string' ? meta.kind : undefined,
            }),
          )
        }
        // Каталог без строк content — только если нет жёстких фильтров status/дат content
        if (!query.status && !query.createdFrom && !query.createdTo && !query.updatedFrom && !query.updatedTo) {
          const needle = query.q.toLowerCase()
          for (const p of PRODUCTS) {
            if (seen.has(p.id)) continue
            if (query.category && p.category !== query.category) continue
            if (query.brand && p.brandId !== query.brand) continue
            if (query.type && p.kind !== query.type) continue
            const hay = `${p.name} ${p.id} ${brandName(p.brandId)} ${p.category} ${p.kind}`.toLowerCase()
            if (needle && !hay.includes(needle)) continue
            productHits.push(catalogHit(p.id, null, null))
          }
        }
      } finally {
        client.release()
      }
    } catch (e) {
      if (!isMissing(e)) throw e
      return searchCmsMemory(query, content, media)
    }
  }

  if (query.scope !== 'products' && media) {
    try {
      const r = await media.list({
        q: query.q || undefined,
        kind: null,
        sort: 'date',
        dir: 'desc',
        offset: 0,
        limit: fetchN,
      })
      for (const m of r.items) {
        if (query.createdFrom && m.createdAt < query.createdFrom) continue
        if (query.createdTo && m.createdAt > query.createdTo) continue
        // brand/category/status/type — только товары
        if (query.category || query.brand || query.status || query.type) continue
        mediaHits.push(mediaHit(m))
      }
    } catch {
      /* skip */
    }
  }

  const merged = [...productHits, ...mediaHits]
  merged.sort((a, b) => {
    const at = a.kind === 'product' ? a.updatedAt || '' : a.createdAt
    const bt = b.kind === 'product' ? b.updatedAt || '' : b.createdAt
    return bt.localeCompare(at) || a.name.localeCompare(b.name, 'ru')
  })
  const total = merged.length
  const start = (query.page - 1) * query.limit
  return { total, page: query.page, limit: query.limit, items: merged.slice(start, start + query.limit) }
}
