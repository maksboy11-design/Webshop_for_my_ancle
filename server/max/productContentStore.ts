/**
 * Хранилище модульного контента товара (product_content, миграции 007/009).
 * Черновик сохраняется отдельно от опубликованной версии; публикация — только явным действием админа
 * (копирует черновик в published, пишет версию в product_versions и запись в cms_activity_log).
 */
import { emptyContent, readProductContent, type ProductContent } from '../../src/cms/blocks'
import type { SqlPool } from './postgresStore'

export interface StoredProductContent {
  productId: string
  draft: ProductContent
  published: ProductContent | null
  status: string
  draftRev: number
  publishedRev: number | null
  updatedAt: string
  publishedAt: string | null
}

export class ProductContentUnavailableError extends Error {
  constructor() {
    super('product_content table is missing')
    this.name = 'ProductContentUnavailableError'
  }
}

export type SaveDraftResult = { ok: true; value: StoredProductContent } | { ok: false; conflict: StoredProductContent }

export interface ProductContentStore {
  get(productId: string): Promise<StoredProductContent | null>
  /** Опубликованный контент всех товаров (для публичного /api/products). */
  listPublished(): Promise<Map<string, ProductContent>>
  /** Сохранение черновика с проверкой ревизии (expectedRev = текущая draft_rev; 0 — записи ещё нет). */
  saveDraft(productId: string, draft: ProductContent, searchText: string, expectedRev: number, userId: string, nowIso: string): Promise<SaveDraftResult>
  /** Явная публикация черновика. null — черновика нет. */
  publish(productId: string, userId: string, nowIso: string): Promise<StoredProductContent | null>
}

const isMissing = (e: unknown) => !!e && typeof e === 'object' && (e as { code?: unknown }).code === '42P01'

interface Row extends Record<string, unknown> {
  product_id: string
  draft: unknown
  published: unknown
  status: string
  draft_rev: number
  published_rev: number | null
  updated_at: string | Date
  published_at: string | Date | null
}

function fromRow(r: Row): StoredProductContent {
  return {
    productId: r.product_id,
    draft: readProductContent(r.draft) ?? emptyContent(),
    published: r.published ? readProductContent(r.published) : null,
    status: r.status,
    draftRev: Number(r.draft_rev),
    publishedRev: r.published_rev === null ? null : Number(r.published_rev),
    updatedAt: new Date(r.updated_at).toISOString(),
    publishedAt: r.published_at ? new Date(r.published_at).toISOString() : null,
  }
}

const COLS = 'product_id, draft, published, status, draft_rev, published_rev, updated_at, published_at'

export function createPgProductContentStore(pool: SqlPool): ProductContentStore {
  type C = Awaited<ReturnType<SqlPool['connect']>>
  async function run<T>(fn: (c: C) => Promise<T>): Promise<T> {
    const c = await pool.connect()
    try {
      return await fn(c)
    } catch (e) {
      if (isMissing(e)) throw new ProductContentUnavailableError()
      throw e
    } finally {
      c.release()
    }
  }
  async function tx<T>(c: C, fn: () => Promise<T>): Promise<T> {
    await c.query('BEGIN')
    try {
      const v = await fn()
      await c.query('COMMIT')
      return v
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined)
      throw e
    }
  }
  const getRow = async (c: C, id: string, lock = false) =>
    (await c.query<Row>(`SELECT ${COLS} FROM product_content WHERE product_id = $1 AND deleted_at IS NULL${lock ? ' FOR UPDATE' : ''}`, [id])).rows[0]
  return {
    get: (id) => run(async (c) => {
      const r = await getRow(c, id)
      return r ? fromRow(r) : null
    }),
    listPublished: () =>
      run(async (c) => {
        const r = await c.query<{ product_id: string; published: unknown }>(
          `SELECT product_id, published FROM product_content WHERE published IS NOT NULL AND deleted_at IS NULL AND status = 'published'`,
        )
        const out = new Map<string, ProductContent>()
        for (const row of r.rows) {
          const p = readProductContent(row.published)
          if (p) out.set(row.product_id, p)
        }
        return out
      }),
    saveDraft: (id, draft, searchText, expectedRev, userId, nowIso) =>
      run((c) =>
        tx(c, async () => {
          const cur = await getRow(c, id, true)
          const curRev = cur ? Number(cur.draft_rev) : 0
          if (curRev !== expectedRev) {
            return { ok: false as const, conflict: cur ? fromRow(cur) : { ...emptyStored(id) } }
          }
          const w = cur
            ? await c.query<Row>(
                `UPDATE product_content SET draft = $2::jsonb, search_text = $3, draft_rev = draft_rev + 1,
                   updated_at = $4::timestamptz, updated_by_user_id = $5::bigint,
                   status = CASE WHEN status = 'archived' THEN status ELSE 'draft' END
                 WHERE product_id = $1 RETURNING ${COLS}`,
                [id, JSON.stringify(draft), searchText, nowIso, userId],
              )
            : await c.query<Row>(
                `INSERT INTO product_content (product_id, draft, search_text, created_at, updated_at, updated_by_user_id)
                 VALUES ($1, $2::jsonb, $3, $4::timestamptz, $4::timestamptz, $5::bigint) RETURNING ${COLS}`,
                [id, JSON.stringify(draft), searchText, nowIso, userId],
              )
          return { ok: true as const, value: fromRow(w.rows[0]!) }
        }),
      ),
    publish: (id, userId, nowIso) =>
      run((c) =>
        tx(c, async () => {
          const cur = await getRow(c, id, true)
          if (!cur) return null
          const rev = (await c.query<{ n: number }>(`SELECT COALESCE(MAX(rev), 0) + 1 AS n FROM product_versions WHERE product_id = $1`, [id])).rows[0]!.n
          const w = await c.query<Row>(
            `UPDATE product_content SET published = draft, published_rev = draft_rev, status = 'published',
               published_at = $2::timestamptz, updated_by_user_id = $3::bigint
             WHERE product_id = $1 RETURNING ${COLS}`,
            [id, nowIso, userId],
          )
          const row = w.rows[0]!
          await c.query(
            `INSERT INTO product_versions (product_id, rev, snapshot, reason, created_by_user_id, created_at)
             VALUES ($1, $2, $3::jsonb, 'publish', $4::bigint, $5::timestamptz)`,
            [id, Number(rev), JSON.stringify(row.draft), userId, nowIso],
          )
          await c.query(
            `INSERT INTO cms_activity_log (at, user_id, action, entity_type, entity_id, details)
             VALUES ($1::timestamptz, $2::bigint, 'product_content_publish', 'product', $3, $4::jsonb)`,
            [nowIso, userId, id, JSON.stringify({ draft_rev: Number(row.draft_rev), version: Number(rev) })],
          )
          return fromRow(row)
        }),
      ),
  }
}

function emptyStored(id: string): StoredProductContent {
  return { productId: id, draft: emptyContent(), published: null, status: 'draft', draftRev: 0, publishedRev: null, updatedAt: new Date(0).toISOString(), publishedAt: null }
}

/** Память — для тестов и локальной разработки без базы. */
export function createMemoryProductContentStore(): ProductContentStore & { versions: { productId: string; rev: number }[]; activity: string[] } {
  const rows = new Map<string, StoredProductContent>()
  const versions: { productId: string; rev: number }[] = []
  const activity: string[] = []
  const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T
  return {
    versions,
    activity,
    async get(id) {
      const r = rows.get(id)
      return r ? copy(r) : null
    },
    async listPublished() {
      const m = new Map<string, ProductContent>()
      for (const r of rows.values()) if (r.published && r.status === 'published') m.set(r.productId, copy(r.published))
      return m
    },
    async saveDraft(id, draft, _s, expectedRev, _u, nowIso) {
      const cur = rows.get(id)
      if ((cur?.draftRev ?? 0) !== expectedRev) return { ok: false, conflict: copy(cur ?? emptyStored(id)) }
      const next: StoredProductContent = { ...(cur ?? emptyStored(id)), draft: copy(draft), draftRev: (cur?.draftRev ?? 0) + 1, status: 'draft', updatedAt: nowIso }
      rows.set(id, next)
      return { ok: true, value: copy(next) }
    },
    async publish(id, _u, nowIso) {
      const cur = rows.get(id)
      if (!cur) return null
      const next = { ...cur, published: copy(cur.draft), publishedRev: cur.draftRev, status: 'published', publishedAt: nowIso }
      rows.set(id, next)
      versions.push({ productId: id, rev: versions.filter((v) => v.productId === id).length + 1 })
      activity.push(`publish:${id}`)
      return copy(next)
    },
  }
}
