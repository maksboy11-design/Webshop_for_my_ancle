/**
 * Хранилище модульного контента товара (product_content, миграции 007/009).
 * Черновик отдельно от опубликованной версии; публикация — только явным действием.
 * Этап 5: статусы, корзина, версии/restore, пакетные операции по id.
 */
import { emptyContent, readProductContent, type ProductContent } from '../../src/cms/blocks'
import { isProductStatus, type ProductStatus } from '../../src/cms/productCard'
import type { SqlPool } from './postgresStore'

export interface StoredProductContent {
  productId: string
  draft: ProductContent
  published: ProductContent | null
  status: ProductStatus
  draftRev: number
  publishedRev: number | null
  updatedAt: string
  publishedAt: string | null
  deletedAt: string | null
}

export interface ProductVersionInfo {
  rev: number
  reason: string
  restoredFromRev: number | null
  createdAt: string
  createdByUserId: string | null
}

export interface ProductSnapshot {
  rev: number
  title: string
  doc: ProductContent
  reason: string
  restoredFromRev: number | null
  createdAt: string
}

export class ProductContentUnavailableError extends Error {
  constructor() {
    super('product_content table is missing')
    this.name = 'ProductContentUnavailableError'
  }
}

export type SaveDraftResult = { ok: true; value: StoredProductContent } | { ok: false; conflict: StoredProductContent }
export type WriteResult = { ok: true; value: StoredProductContent } | { ok: false; error: string; current?: StoredProductContent }

export interface ContentListQuery {
  ids?: readonly string[]
  status?: ProductStatus | 'all'
  trash?: boolean
}

export interface ProductContentStore {
  get(productId: string, opts?: { includeDeleted?: boolean }): Promise<StoredProductContent | null>
  /** Статусы/deleted_at по списку id (без полной выгрузки каталога). */
  summarize(
    ids: readonly string[],
  ): Promise<Map<string, Pick<StoredProductContent, 'status' | 'deletedAt' | 'updatedAt' | 'publishedAt' | 'draftRev' | 'publishedRev'>>>
  /** Только id+статус (без draft/published jsonb) — для каталога админки. */
  listIds(): Promise<{ productId: string; status: ProductStatus; deletedAt: string | null; updatedAt: string; draftRev: number }[]>
  listPublished(): Promise<Map<string, ProductContent>>
  /** id с deleted_at или archived — чтобы публичный каталог их скрыл. */
  listHiddenIds(): Promise<{ deleted: string[]; archived: string[] }>
  saveDraft(
    productId: string,
    draft: ProductContent,
    searchText: string,
    expectedRev: number,
    userId: string,
    nowIso: string,
  ): Promise<SaveDraftResult>
  publish(productId: string, userId: string, nowIso: string): Promise<StoredProductContent | null>
  unpublish(productId: string, userId: string, nowIso: string): Promise<WriteResult>
  setStatus(productId: string, status: ProductStatus, userId: string, nowIso: string): Promise<WriteResult>
  trash(productId: string, userId: string, nowIso: string): Promise<WriteResult>
  restore(productId: string, userId: string, nowIso: string): Promise<WriteResult>
  /** Физическое удаление строки (только из корзины). Связи media не трогает — их чистит mediaStore. */
  purge(productId: string): Promise<'ok' | 'not_trashed' | 'not_found'>
  /** Удалить из корзины старше keepDays (по требованию; cron на Hobby не добавляем — слот занят). */
  purgeExpired(keepDays: number, nowIso: string): Promise<{ purged: string[] }>
  versions(productId: string): Promise<ProductVersionInfo[]>
  version(productId: string, rev: number): Promise<ProductSnapshot | null>
  restoreVersion(productId: string, rev: number, userId: string, nowIso: string): Promise<WriteResult>
  /** Пакет по конкретным id (не load-all). Одна транзакция на партию. */
  bulk(
    ids: readonly string[],
    fn: (
      id: string,
      cur: StoredProductContent | null,
    ) => Promise<
      | {
          draft?: ProductContent
          status?: ProductStatus
          trash?: boolean
          restore?: boolean
          publish?: boolean
          unpublish?: boolean
          searchText?: string
        }
      | { skip: string }
      | { error: string }
    >,
    userId: string,
    nowIso: string,
  ): Promise<{ ok: string[]; failed: { id: string; error: string }[] }>
  /** Копия строки контента под новый id (без файлов). */
  duplicateContent(sourceId: string, targetId: string, draft: ProductContent, userId: string, nowIso: string): Promise<WriteResult>
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
  deleted_at?: string | Date | null
}

function asStatus(v: string): ProductStatus {
  return isProductStatus(v) ? v : 'draft'
}

function fromRow(r: Row): StoredProductContent {
  return {
    productId: r.product_id,
    draft: readProductContent(r.draft) ?? emptyContent(),
    published: r.published ? readProductContent(r.published) : null,
    status: asStatus(r.status),
    draftRev: Number(r.draft_rev),
    publishedRev: r.published_rev === null ? null : Number(r.published_rev),
    updatedAt: new Date(r.updated_at).toISOString(),
    publishedAt: r.published_at ? new Date(r.published_at).toISOString() : null,
    deletedAt: r.deleted_at ? new Date(r.deleted_at).toISOString() : null,
  }
}

const COLS = 'product_id, draft, published, status, draft_rev, published_rev, updated_at, published_at, deleted_at'

function emptyStored(id: string): StoredProductContent {
  return {
    productId: id,
    draft: emptyContent(),
    published: null,
    status: 'draft',
    draftRev: 0,
    publishedRev: null,
    updatedAt: new Date(0).toISOString(),
    publishedAt: null,
    deletedAt: null,
  }
}

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
  const getRow = async (c: C, id: string, lock = false, includeDeleted = false) =>
    (
      await c.query<Row>(
        `SELECT ${COLS} FROM product_content WHERE product_id = $1${includeDeleted ? '' : ' AND deleted_at IS NULL'}${lock ? ' FOR UPDATE' : ''}`,
        [id],
      )
    ).rows[0]

  async function nextRev(c: C, id: string) {
    return (await c.query<{ n: number }>(`SELECT COALESCE(MAX(rev), 0) + 1 AS n FROM product_versions WHERE product_id = $1`, [id]))
      .rows[0]!.n
  }
  async function insertVersion(
    c: C,
    id: string,
    rev: number,
    snap: unknown,
    reason: string,
    userId: string,
    nowIso: string,
    restoredFrom: number | null = null,
  ) {
    await c.query(
      `INSERT INTO product_versions (product_id, rev, snapshot, reason, restored_from_rev, created_by_user_id, created_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6::bigint, $7::timestamptz)`,
      [id, rev, JSON.stringify(snap), reason, restoredFrom, userId, nowIso],
    )
  }
  async function log(c: C, nowIso: string, userId: string, action: string, id: string, details: Record<string, unknown>) {
    await c.query(
      `INSERT INTO cms_activity_log (at, user_id, action, entity_type, entity_id, details)
       VALUES ($1::timestamptz, $2::bigint, $3, 'product', $4, $5::jsonb)`,
      [nowIso, userId, action, id, JSON.stringify(details)],
    )
  }

  return {
    get: (id, opts) =>
      run(async (c) => {
        const r = await getRow(c, id, false, opts?.includeDeleted === true)
        return r ? fromRow(r) : null
      }),
    summarize: (ids) =>
      run(async (c) => {
        const out = new Map<
          string,
          Pick<StoredProductContent, 'status' | 'deletedAt' | 'updatedAt' | 'publishedAt' | 'draftRev' | 'publishedRev'>
        >()
        if (!ids.length) return out
        const r = await c.query<Row>(`SELECT ${COLS} FROM product_content WHERE product_id = ANY($1::text[])`, [ids])
        for (const row of r.rows) {
          const s = fromRow(row)
          out.set(s.productId, {
            status: s.status,
            deletedAt: s.deletedAt,
            updatedAt: s.updatedAt,
            publishedAt: s.publishedAt,
            draftRev: s.draftRev,
            publishedRev: s.publishedRev,
          })
        }
        return out
      }),
    listIds: () =>
      run(async (c) => {
        const r = await c.query<{
          product_id: string
          status: string
          deleted_at: string | Date | null
          updated_at: string | Date
          draft_rev: number
        }>(`SELECT product_id, status, deleted_at, updated_at, draft_rev FROM product_content ORDER BY updated_at DESC LIMIT 5000`)
        return r.rows.map((row) => ({
          productId: row.product_id,
          status: asStatus(row.status),
          deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
          updatedAt: new Date(row.updated_at).toISOString(),
          draftRev: Number(row.draft_rev),
        }))
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
    listHiddenIds: () =>
      run(async (c) => {
        const r = await c.query<{ product_id: string; status: string; deleted_at: string | Date | null }>(
          `SELECT product_id, status, deleted_at FROM product_content WHERE deleted_at IS NOT NULL OR status = 'archived'`,
        )
        const deleted: string[] = []
        const archived: string[] = []
        for (const row of r.rows) {
          if (row.deleted_at) deleted.push(row.product_id)
          else if (row.status === 'archived') archived.push(row.product_id)
        }
        return { deleted, archived }
      }),
    saveDraft: (id, draft, searchText, expectedRev, userId, nowIso) =>
      run((c) =>
        tx(c, async () => {
          const cur = await getRow(c, id, true)
          const curRev = cur ? Number(cur.draft_rev) : 0
          if (curRev !== expectedRev) return { ok: false as const, conflict: cur ? fromRow(cur) : { ...emptyStored(id) } }
          const w = cur
            ? await c.query<Row>(
                `UPDATE product_content SET draft = $2::jsonb, search_text = $3, draft_rev = draft_rev + 1,
                   updated_at = $4::timestamptz, updated_by_user_id = $5::bigint,
                   status = CASE WHEN status IN ('archived', 'published', 'review') THEN status ELSE 'draft' END
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
          const rev = await nextRev(c, id)
          const w = await c.query<Row>(
            `UPDATE product_content SET published = draft, published_rev = draft_rev, status = 'published',
               published_at = $2::timestamptz, updated_at = $2::timestamptz, updated_by_user_id = $3::bigint
             WHERE product_id = $1 RETURNING ${COLS}`,
            [id, nowIso, userId],
          )
          const row = w.rows[0]!
          await insertVersion(c, id, Number(rev), row.draft, 'publish', userId, nowIso)
          await log(c, nowIso, userId, 'product_content_publish', id, { draft_rev: Number(row.draft_rev), version: Number(rev) })
          return fromRow(row)
        }),
      ),
    unpublish: (id, userId, nowIso) =>
      run((c) =>
        tx(c, async () => {
          const cur = await getRow(c, id, true)
          if (!cur) return { ok: false as const, error: 'not_found' }
          const rev = await nextRev(c, id)
          const w = await c.query<Row>(
            `UPDATE product_content SET status = 'draft', updated_at = $2::timestamptz, updated_by_user_id = $3::bigint
             WHERE product_id = $1 RETURNING ${COLS}`,
            [id, nowIso, userId],
          )
          await insertVersion(c, id, Number(rev), cur.draft, 'unpublish', userId, nowIso)
          await log(c, nowIso, userId, 'product_unpublish', id, {})
          return { ok: true as const, value: fromRow(w.rows[0]!) }
        }),
      ),
    setStatus: (id, status, userId, nowIso) =>
      run((c) =>
        tx(c, async () => {
          let cur = await getRow(c, id, true)
          if (!cur) {
            await c.query(
              `INSERT INTO product_content (product_id, draft, status, created_at, updated_at, updated_by_user_id)
               VALUES ($1, $2::jsonb, $3, $4::timestamptz, $4::timestamptz, $5::bigint)`,
              [id, JSON.stringify(emptyContent()), status === 'published' ? 'draft' : status, nowIso, userId],
            )
            cur = await getRow(c, id, true)
          }
          if (!cur) return { ok: false as const, error: 'not_found' }
          // published выставляется только через publish()
          const nextStatus = status === 'published' ? 'review' : status
          const w = await c.query<Row>(
            `UPDATE product_content SET status = $2, updated_at = $3::timestamptz, updated_by_user_id = $4::bigint
             WHERE product_id = $1 RETURNING ${COLS}`,
            [id, nextStatus, nowIso, userId],
          )
          await log(c, nowIso, userId, 'product_status', id, { status: nextStatus })
          return { ok: true as const, value: fromRow(w.rows[0]!) }
        }),
      ),
    trash: (id, userId, nowIso) =>
      run((c) =>
        tx(c, async () => {
          const cur = await getRow(c, id, true)
          if (!cur) {
            await c.query(
              `INSERT INTO product_content (product_id, draft, status, created_at, updated_at, updated_by_user_id, deleted_at)
               VALUES ($1, $2::jsonb, 'draft', $3::timestamptz, $3::timestamptz, $4::bigint, $3::timestamptz)`,
              [id, JSON.stringify(emptyContent()), nowIso, userId],
            )
            await log(c, nowIso, userId, 'product_trash', id, {})
            return { ok: true as const, value: { ...emptyStored(id), deletedAt: nowIso, updatedAt: nowIso } }
          }
          const w = await c.query<Row>(
            `UPDATE product_content SET deleted_at = $2::timestamptz, updated_at = $2::timestamptz, updated_by_user_id = $3::bigint
             WHERE product_id = $1 RETURNING ${COLS}`,
            [id, nowIso, userId],
          )
          await log(c, nowIso, userId, 'product_trash', id, {})
          return { ok: true as const, value: fromRow(w.rows[0]!) }
        }),
      ),
    restore: (id, userId, nowIso) =>
      run((c) =>
        tx(c, async () => {
          const cur = await getRow(c, id, true, true)
          if (!cur || !cur.deleted_at) return { ok: false as const, error: 'not_trashed' }
          const w = await c.query<Row>(
            `UPDATE product_content SET deleted_at = NULL, updated_at = $2::timestamptz, updated_by_user_id = $3::bigint
             WHERE product_id = $1 RETURNING ${COLS}`,
            [id, nowIso, userId],
          )
          await log(c, nowIso, userId, 'product_restore', id, {})
          return { ok: true as const, value: fromRow(w.rows[0]!) }
        }),
      ),
    purge: (id) =>
      run(async (c) => {
        const cur = await getRow(c, id, true, true)
        if (!cur) return 'not_found'
        if (!cur.deleted_at) return 'not_trashed'
        await c.query(`DELETE FROM product_versions WHERE product_id = $1`, [id])
        await c.query(`DELETE FROM product_content WHERE product_id = $1`, [id])
        return 'ok'
      }),
    purgeExpired: (keepDays, nowIso) =>
      run((c) =>
        tx(c, async () => {
          const r = await c.query<{ product_id: string }>(
            `SELECT product_id FROM product_content
             WHERE deleted_at IS NOT NULL AND deleted_at < ($1::timestamptz - ($2::int || ' days')::interval)`,
            [nowIso, keepDays],
          )
          const purged: string[] = []
          for (const row of r.rows) {
            await c.query(`DELETE FROM product_versions WHERE product_id = $1`, [row.product_id])
            await c.query(`DELETE FROM product_content WHERE product_id = $1`, [row.product_id])
            purged.push(row.product_id)
          }
          return { purged }
        }),
      ),
    versions: (id) =>
      run(async (c) => {
        const r = await c.query<{
          rev: number
          reason: string
          restored_from_rev: number | null
          created_at: string | Date
          created_by_user_id: string | null
        }>(
          `SELECT rev, reason, restored_from_rev, created_at, created_by_user_id FROM product_versions WHERE product_id = $1 ORDER BY rev DESC LIMIT 100`,
          [id],
        )
        return r.rows.map((v) => ({
          rev: Number(v.rev),
          reason: v.reason,
          restoredFromRev: v.restored_from_rev === null ? null : Number(v.restored_from_rev),
          createdAt: new Date(v.created_at).toISOString(),
          createdByUserId: v.created_by_user_id == null ? null : String(v.created_by_user_id),
        }))
      }),
    version: (id, rev) =>
      run(async (c) => {
        const r = await c.query<{
          rev: number
          snapshot: unknown
          reason: string
          restored_from_rev: number | null
          created_at: string | Date
        }>(`SELECT rev, snapshot, reason, restored_from_rev, created_at FROM product_versions WHERE product_id = $1 AND rev = $2`, [
          id,
          rev,
        ])
        const row = r.rows[0]
        if (!row) return null
        const doc = readProductContent(row.snapshot) ?? emptyContent()
        return {
          rev: Number(row.rev),
          title: typeof doc.meta.name === 'string' ? doc.meta.name : id,
          doc,
          reason: row.reason,
          restoredFromRev: row.restored_from_rev === null ? null : Number(row.restored_from_rev),
          createdAt: new Date(row.created_at).toISOString(),
        }
      }),
    restoreVersion: (id, rev, userId, nowIso) =>
      run((c) =>
        tx(c, async () => {
          const cur = await getRow(c, id, true)
          if (!cur) return { ok: false as const, error: 'not_found' }
          const snap = await c.query<{ snapshot: unknown }>(`SELECT snapshot FROM product_versions WHERE product_id = $1 AND rev = $2`, [
            id,
            rev,
          ])
          const raw = snap.rows[0]?.snapshot
          const doc = readProductContent(raw)
          if (!doc) return { ok: false as const, error: 'version_missing' }
          const newRev = await nextRev(c, id)
          const w = await c.query<Row>(
            `UPDATE product_content SET draft = $2::jsonb, draft_rev = draft_rev + 1, updated_at = $3::timestamptz, updated_by_user_id = $4::bigint
             WHERE product_id = $1 RETURNING ${COLS}`,
            [id, JSON.stringify(doc), nowIso, userId],
          )
          await insertVersion(c, id, Number(newRev), doc, 'restore', userId, nowIso, rev)
          await log(c, nowIso, userId, 'product_restore_version', id, { from: rev, to: Number(newRev) })
          return { ok: true as const, value: fromRow(w.rows[0]!) }
        }),
      ),
    bulk: (ids, fn, userId, nowIso) =>
      run((c) =>
        tx(c, async () => {
          const ok: string[] = []
          const failed: { id: string; error: string }[] = []
          for (const id of ids) {
            try {
              const cur = await getRow(c, id, true, true)
              const stored = cur ? fromRow(cur) : null
              const plan = await fn(id, stored)
              if ('skip' in plan) {
                failed.push({ id, error: plan.skip })
                continue
              }
              if ('error' in plan) {
                failed.push({ id, error: plan.error })
                continue
              }
              let row = cur
              if (!row) {
                await c.query(
                  `INSERT INTO product_content (product_id, draft, created_at, updated_at, updated_by_user_id)
                   VALUES ($1, $2::jsonb, $3::timestamptz, $3::timestamptz, $4::bigint)`,
                  [id, JSON.stringify(plan.draft ?? emptyContent()), nowIso, userId],
                )
                row = await getRow(c, id, true, true)
              }
              if (!row) {
                failed.push({ id, error: 'not_found' })
                continue
              }
              if (plan.restore) {
                await c.query(
                  `UPDATE product_content SET deleted_at = NULL, updated_at = $2::timestamptz, updated_by_user_id = $3::bigint WHERE product_id = $1`,
                  [id, nowIso, userId],
                )
              }
              if (plan.trash) {
                await c.query(
                  `UPDATE product_content SET deleted_at = $2::timestamptz, updated_at = $2::timestamptz, updated_by_user_id = $3::bigint WHERE product_id = $1`,
                  [id, nowIso, userId],
                )
              }
              if (plan.draft) {
                await c.query(
                  `UPDATE product_content SET draft = $2::jsonb, search_text = COALESCE($3, search_text), draft_rev = draft_rev + 1,
                     updated_at = $4::timestamptz, updated_by_user_id = $5::bigint WHERE product_id = $1`,
                  [id, JSON.stringify(plan.draft), plan.searchText ?? null, nowIso, userId],
                )
              }
              if (plan.publish) {
                const rev = await nextRev(c, id)
                const pub = await c.query<Row>(
                  `UPDATE product_content SET published = draft, published_rev = draft_rev, status = 'published', published_at = $2::timestamptz,
                     updated_at = $2::timestamptz, updated_by_user_id = $3::bigint, deleted_at = NULL WHERE product_id = $1 RETURNING ${COLS}`,
                  [id, nowIso, userId],
                )
                await insertVersion(c, id, Number(rev), pub.rows[0]!.draft, 'bulk', userId, nowIso)
              } else if (plan.unpublish) {
                await c.query(
                  `UPDATE product_content SET status = 'draft', updated_at = $2::timestamptz, updated_by_user_id = $3::bigint WHERE product_id = $1`,
                  [id, nowIso, userId],
                )
              } else if (plan.status) {
                const st = plan.status === 'published' ? 'review' : plan.status
                await c.query(
                  `UPDATE product_content SET status = $2, updated_at = $3::timestamptz, updated_by_user_id = $4::bigint WHERE product_id = $1`,
                  [id, st, nowIso, userId],
                )
              }
              await log(c, nowIso, userId, 'product_bulk', id, { op: Object.keys(plan) })
              ok.push(id)
            } catch (e) {
              failed.push({ id, error: e instanceof Error ? e.message : 'failed' })
            }
          }
          return { ok, failed }
        }),
      ),
    duplicateContent: (sourceId, targetId, draft, userId, nowIso) =>
      run((c) =>
        tx(c, async () => {
          const exists = await getRow(c, targetId, false, true)
          if (exists) return { ok: false as const, error: 'id_taken' }
          const w = await c.query<Row>(
            `INSERT INTO product_content (product_id, draft, status, created_at, updated_at, updated_by_user_id)
             VALUES ($1, $2::jsonb, 'draft', $3::timestamptz, $3::timestamptz, $4::bigint) RETURNING ${COLS}`,
            [targetId, JSON.stringify(draft), nowIso, userId],
          )
          await log(c, nowIso, userId, 'product_duplicate', targetId, { from: sourceId })
          return { ok: true as const, value: fromRow(w.rows[0]!) }
        }),
      ),
  }
}

/** Память — для тестов и локальной разработки без базы. */
export function createMemoryProductContentStore(): ProductContentStore & {
  versionLog: { productId: string; rev: number; reason: string; snapshot: ProductContent; restoredFromRev: number | null }[]
  activity: string[]
  rows: Map<string, StoredProductContent>
} {
  const rows = new Map<string, StoredProductContent>()
  const versions: { productId: string; rev: number; reason: string; snapshot: ProductContent; restoredFromRev: number | null }[] = []
  const activity: string[] = []
  const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
  const pushVer = (id: string, snap: ProductContent, reason: string, restoredFromRev: number | null = null) => {
    const rev = versions.filter((v) => v.productId === id).length + 1
    versions.push({ productId: id, rev, reason, snapshot: copy(snap), restoredFromRev })
    return rev
  }
  return {
    versionLog: versions,
    activity,
    rows,
    async get(id, opts) {
      const r = rows.get(id)
      if (!r) return null
      if (r.deletedAt && !opts?.includeDeleted) return null
      return copy(r)
    },
    async summarize(ids) {
      const m = new Map<
        string,
        Pick<StoredProductContent, 'status' | 'deletedAt' | 'updatedAt' | 'publishedAt' | 'draftRev' | 'publishedRev'>
      >()
      for (const id of ids) {
        const r = rows.get(id)
        if (r)
          m.set(id, {
            status: r.status,
            deletedAt: r.deletedAt,
            updatedAt: r.updatedAt,
            publishedAt: r.publishedAt,
            draftRev: r.draftRev,
            publishedRev: r.publishedRev,
          })
      }
      return m
    },
    async listIds() {
      return [...rows.values()].map((r) => ({
        productId: r.productId,
        status: r.status,
        deletedAt: r.deletedAt,
        updatedAt: r.updatedAt,
        draftRev: r.draftRev,
      }))
    },
    async listPublished() {
      const m = new Map<string, ProductContent>()
      for (const r of rows.values()) if (r.published && r.status === 'published' && !r.deletedAt) m.set(r.productId, copy(r.published))
      return m
    },
    async listHiddenIds() {
      const deleted: string[] = []
      const archived: string[] = []
      for (const r of rows.values()) {
        if (r.deletedAt) deleted.push(r.productId)
        else if (r.status === 'archived') archived.push(r.productId)
      }
      return { deleted, archived }
    },
    async saveDraft(id, draft, _s, expectedRev, _u, nowIso) {
      const cur = rows.get(id)
      if (cur?.deletedAt) return { ok: false, conflict: copy(cur) }
      if ((cur?.draftRev ?? 0) !== expectedRev) return { ok: false, conflict: copy(cur ?? emptyStored(id)) }
      const status: ProductStatus =
        cur && (cur.status === 'archived' || cur.status === 'published' || cur.status === 'review') ? cur.status : 'draft'
      const next: StoredProductContent = {
        ...(cur ?? emptyStored(id)),
        draft: copy(draft),
        draftRev: (cur?.draftRev ?? 0) + 1,
        status,
        updatedAt: nowIso,
        deletedAt: null,
      }
      rows.set(id, next)
      return { ok: true, value: copy(next) }
    },
    async publish(id, _u, nowIso) {
      const cur = rows.get(id)
      if (!cur || cur.deletedAt) return null
      const next = {
        ...cur,
        published: copy(cur.draft),
        publishedRev: cur.draftRev,
        status: 'published' as const,
        publishedAt: nowIso,
        updatedAt: nowIso,
      }
      rows.set(id, next)
      pushVer(id, cur.draft, 'publish')
      activity.push(`publish:${id}`)
      return copy(next)
    },
    async unpublish(id, _u, nowIso) {
      const cur = rows.get(id)
      if (!cur || cur.deletedAt) return { ok: false, error: 'not_found' }
      pushVer(id, cur.draft, 'unpublish')
      const next = { ...cur, status: 'draft' as const, updatedAt: nowIso }
      rows.set(id, next)
      activity.push(`unpublish:${id}`)
      return { ok: true, value: copy(next) }
    },
    async setStatus(id, status, _u, nowIso) {
      const cur = rows.get(id) ?? emptyStored(id)
      if (cur.deletedAt) return { ok: false, error: 'trashed' }
      const nextStatus: ProductStatus = status === 'published' ? 'review' : status
      const next = { ...cur, status: nextStatus, updatedAt: nowIso, deletedAt: null }
      rows.set(id, next)
      activity.push(`status:${id}:${nextStatus}`)
      return { ok: true, value: copy(next) }
    },
    async trash(id, _u, nowIso) {
      const cur = rows.get(id) ?? emptyStored(id)
      const next = { ...cur, deletedAt: nowIso, updatedAt: nowIso }
      rows.set(id, next)
      activity.push(`trash:${id}`)
      return { ok: true, value: copy(next) }
    },
    async restore(id, _u, nowIso) {
      const cur = rows.get(id)
      if (!cur?.deletedAt) return { ok: false, error: 'not_trashed' }
      const next = { ...cur, deletedAt: null, updatedAt: nowIso }
      rows.set(id, next)
      activity.push(`restore:${id}`)
      return { ok: true, value: copy(next) }
    },
    async purge(id) {
      const cur = rows.get(id)
      if (!cur) return 'not_found'
      if (!cur.deletedAt) return 'not_trashed'
      rows.delete(id)
      for (let i = versions.length - 1; i >= 0; i--) if (versions[i]!.productId === id) versions.splice(i, 1)
      return 'ok'
    },
    async purgeExpired(keepDays, nowIso) {
      const cutoff = Date.parse(nowIso) - keepDays * 864e5
      const purged: string[] = []
      for (const [id, r] of [...rows.entries()]) {
        if (r.deletedAt && Date.parse(r.deletedAt) < cutoff) {
          rows.delete(id)
          purged.push(id)
        }
      }
      return { purged }
    },
    async versions(id) {
      return versions
        .filter((v) => v.productId === id)
        .map((v) => ({
          rev: v.rev,
          reason: v.reason,
          restoredFromRev: v.restoredFromRev,
          createdAt: new Date(0).toISOString(),
          createdByUserId: null,
        }))
        .sort((a, b) => b.rev - a.rev)
    },
    async version(id, rev) {
      const v = versions.find((x) => x.productId === id && x.rev === rev)
      if (!v) return null
      return {
        rev: v.rev,
        title: id,
        doc: copy(v.snapshot),
        reason: v.reason,
        restoredFromRev: v.restoredFromRev,
        createdAt: new Date(0).toISOString(),
      }
    },
    async restoreVersion(id, rev, _u, nowIso) {
      const cur = rows.get(id)
      if (!cur || cur.deletedAt) return { ok: false, error: 'not_found' }
      const v = versions.find((x) => x.productId === id && x.rev === rev)
      if (!v) return { ok: false, error: 'version_missing' }
      pushVer(id, v.snapshot, 'restore', rev)
      const next = { ...cur, draft: copy(v.snapshot), draftRev: cur.draftRev + 1, updatedAt: nowIso }
      rows.set(id, next)
      activity.push(`restoreVersion:${id}:${rev}`)
      return { ok: true, value: copy(next) }
    },
    async bulk(ids, fn, _u, nowIso) {
      const ok: string[] = []
      const failed: { id: string; error: string }[] = []
      for (const id of ids) {
        const cur = rows.get(id) ?? null
        const plan = await fn(id, cur ? copy(cur) : null)
        if ('skip' in plan) {
          failed.push({ id, error: plan.skip })
          continue
        }
        if ('error' in plan) {
          failed.push({ id, error: plan.error })
          continue
        }
        let row = cur ?? emptyStored(id)
        if (plan.restore) row = { ...row, deletedAt: null }
        if (plan.trash) row = { ...row, deletedAt: nowIso }
        if (plan.draft) row = { ...row, draft: copy(plan.draft), draftRev: row.draftRev + 1 }
        if (plan.publish) {
          row = {
            ...row,
            published: copy(row.draft),
            publishedRev: row.draftRev,
            status: 'published',
            publishedAt: nowIso,
            deletedAt: null,
          }
          pushVer(id, row.draft, 'bulk')
        } else if (plan.unpublish) row = { ...row, status: 'draft' }
        else if (plan.status) row = { ...row, status: plan.status === 'published' ? 'review' : plan.status }
        row = { ...row, updatedAt: nowIso }
        rows.set(id, row)
        activity.push(`bulk:${id}`)
        ok.push(id)
      }
      return { ok, failed }
    },
    async duplicateContent(sourceId, targetId, draft, _u, nowIso) {
      if (rows.has(targetId)) return { ok: false, error: 'id_taken' }
      const next: StoredProductContent = { ...emptyStored(targetId), draft: copy(draft), draftRev: 1, updatedAt: nowIso }
      rows.set(targetId, next)
      activity.push(`duplicate:${sourceId}->${targetId}`)
      return { ok: true, value: copy(next) }
    },
  }
}
