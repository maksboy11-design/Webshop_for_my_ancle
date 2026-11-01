/**
 * Медиатека (таблицы media и product_media, миграция 008). В БД — только метаданные; файлы в Vercel Blob.
 * Удаление — сначала в корзину (deleted_at), физически — только из корзины и только если файл нигде не используется.
 */
import type { MediaKind, MediaVariant } from '../../src/cms/mediaTypes'
import type { SqlPool } from './postgresStore'

export type MediaStatus = 'uploading' | 'processing' | 'ready' | 'failed'

export interface MediaRecord {
  id: string
  kind: MediaKind
  mime: string
  sizeBytes: number
  sha256: string | null
  originalName: string
  title: string | null
  blobUrl: string
  variants: Record<string, MediaVariant>
  width: number | null
  height: number | null
  status: MediaStatus
  error: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface MediaUsage {
  productId: string
  role: string
  blockId: string
  position: number
  /** Использование на странице (раздел «Страницы»). */
  pageId?: string
  title?: string
}

export type MediaSort = 'date' | 'size'

export interface MediaListQuery {
  q?: string
  kind?: MediaKind | null
  sort: MediaSort
  dir: 'asc' | 'desc'
  offset: number
  limit: number
  trash?: boolean
}

export type GalleryRole = 'main' | 'gallery' | 'document'
/** Что заменяет PUT: фото (main+gallery) или документы. */
export type LinkScope = 'images' | 'documents'
const SCOPE_ROLES: Record<LinkScope, GalleryRole[]> = { images: ['main', 'gallery'], documents: ['document'] }
const ROLE_ORDER: Record<string, number> = { main: 0, gallery: 1, document: 2 }

export interface ProductMediaLink {
  mediaId: string
  role: GalleryRole
  position: number
  media: MediaRecord
}

export type MediaPatch = Partial<Pick<MediaRecord, 'status' | 'error' | 'variants' | 'width' | 'height' | 'sha256' | 'title'>>

export interface NewMedia {
  id: string
  kind: MediaKind
  mime: string
  sizeBytes: number
  sha256: string | null
  originalName: string
  blobUrl: string
  status: MediaStatus
  createdByUserId: string | null
  nowIso: string
}

export class MediaUnavailableError extends Error {
  constructor() {
    super('media tables are missing')
    this.name = 'MediaUnavailableError'
  }
}

export interface MediaStore {
  get(id: string): Promise<MediaRecord | null>
  findBySha(sha256: string): Promise<MediaRecord | null>
  /** Идемпотентная вставка: тот же id → существующая запись (created=false). */
  insert(m: NewMedia): Promise<{ record: MediaRecord; created: boolean }>
  update(id: string, patch: MediaPatch, nowIso: string): Promise<MediaRecord | null>
  list(q: MediaListQuery): Promise<{ total: number; items: MediaRecord[] }>
  usage(id: string): Promise<MediaUsage[]>
  /** В корзину. Если используется и unlink=false — 'in_use'. unlink=true — снять связи и убрать в корзину. */
  trash(id: string, unlink: boolean, nowIso: string): Promise<'ok' | 'in_use' | 'not_found'>
  restore(id: string, nowIso: string): Promise<MediaRecord | null>
  /** Физическое удаление записи: только из корзины и без использований. Возвращает удалённую запись. */
  purge(id: string): Promise<{ result: 'ok'; record: MediaRecord } | { result: 'in_use' | 'not_trashed' | 'not_found' }>
  productMedia(productId: string): Promise<ProductMediaLink[]>
  /** Заменить главное фото и галерею товара (один запрос, в транзакции). */
  setProductMedia(productId: string, items: { mediaId: string; role: GalleryRole }[], scope?: LinkScope): Promise<ProductMediaLink[]>
  /** Для публичного API: готовые изображения товаров (main/gallery), без удалённых. */
  allProductImages(): Promise<Map<string, ProductMediaLink[]>>
}

/* ---------------- Память (тесты, dev) ---------------- */

export function createMemoryMediaStore(): MediaStore & {
  rows: Map<string, MediaRecord>
  links: { productId: string; mediaId: string; role: string; position: number }[]
} {
  const rows = new Map<string, MediaRecord>()
  let links: { productId: string; mediaId: string; role: string; position: number }[] = []
  const live = (m: MediaRecord | undefined) => (m && !m.deletedAt ? m : null)
  const linksOf = (productId: string) =>
    links
      .filter((l) => l.productId === productId && l.role in ROLE_ORDER)
      .sort((a, b) => (a.role === b.role ? a.position - b.position : ROLE_ORDER[a.role]! - ROLE_ORDER[b.role]!))
      .map((l) => ({ mediaId: l.mediaId, role: l.role as GalleryRole, position: l.position, media: rows.get(l.mediaId)! }))
  const store: MediaStore = {
    async get(id) {
      return rows.get(id) ?? null
    },
    async findBySha(sha) {
      return [...rows.values()].find((m) => m.sha256 === sha && !m.deletedAt) ?? null
    },
    async insert(m) {
      const cur = rows.get(m.id)
      if (cur) return { record: cur, created: false }
      if (m.sha256 && (await store.findBySha(m.sha256))) throw Object.assign(new Error('duplicate sha'), { code: '23505' })
      const rec: MediaRecord = {
        id: m.id,
        kind: m.kind,
        mime: m.mime,
        sizeBytes: m.sizeBytes,
        sha256: m.sha256,
        originalName: m.originalName,
        title: null,
        blobUrl: m.blobUrl,
        variants: {},
        width: null,
        height: null,
        status: m.status,
        error: null,
        createdAt: m.nowIso,
        updatedAt: m.nowIso,
        deletedAt: null,
      }
      rows.set(m.id, rec)
      return { record: rec, created: true }
    },
    async update(id, patch, nowIso) {
      const cur = rows.get(id)
      if (!cur) return null
      const next = { ...cur, ...patch, updatedAt: nowIso }
      rows.set(id, next)
      return next
    },
    async list(q) {
      const needle = q.q?.trim().toLowerCase() ?? ''
      const all = [...rows.values()]
        .filter((m) => (q.trash ? !!m.deletedAt : !m.deletedAt))
        .filter((m) => !q.kind || m.kind === q.kind)
        .filter((m) => !needle || m.originalName.toLowerCase().includes(needle) || (m.title ?? '').toLowerCase().includes(needle))
        .sort((a, b) => {
          const d = q.sort === 'size' ? a.sizeBytes - b.sizeBytes : a.createdAt.localeCompare(b.createdAt)
          return (q.dir === 'asc' ? d : -d) || a.id.localeCompare(b.id)
        })
      return { total: all.length, items: all.slice(q.offset, q.offset + q.limit) }
    },
    async usage(id) {
      return links.filter((l) => l.mediaId === id).map((l) => ({ productId: l.productId, role: l.role, blockId: '', position: l.position }))
    },
    async trash(id, unlink, nowIso) {
      const cur = live(rows.get(id))
      if (!cur) return 'not_found'
      if (links.some((l) => l.mediaId === id)) {
        if (!unlink) return 'in_use'
        links = links.filter((l) => l.mediaId !== id)
      }
      rows.set(id, { ...cur, deletedAt: nowIso, updatedAt: nowIso })
      return 'ok'
    },
    async restore(id, nowIso) {
      const cur = rows.get(id)
      if (!cur || !cur.deletedAt) return null
      if (cur.sha256 && (await store.findBySha(cur.sha256))) throw Object.assign(new Error('duplicate sha'), { code: '23505' })
      const next = { ...cur, deletedAt: null, updatedAt: nowIso }
      rows.set(id, next)
      return next
    },
    async purge(id) {
      const cur = rows.get(id)
      if (!cur) return { result: 'not_found' }
      if (!cur.deletedAt) return { result: 'not_trashed' }
      if (links.some((l) => l.mediaId === id)) return { result: 'in_use' }
      rows.delete(id)
      return { result: 'ok', record: cur }
    },
    async productMedia(productId) {
      return linksOf(productId)
    },
    async setProductMedia(productId, items, scope = 'images') {
      const roles: string[] = SCOPE_ROLES[scope]
      links = links.filter((l) => !(l.productId === productId && roles.includes(l.role)))
      let pos = 0
      for (const it of items) links.push({ productId, mediaId: it.mediaId, role: it.role, position: it.role === 'main' ? 0 : pos++ })
      return linksOf(productId)
    },
    async allProductImages() {
      const out = new Map<string, ProductMediaLink[]>()
      for (const pid of new Set(links.map((l) => l.productId))) {
        const ok = linksOf(pid).filter(
          (l) => l.media && !l.media.deletedAt && l.media.status === 'ready' && (l.media.kind === 'image' || l.role === 'document'),
        )
        if (ok.length) out.set(pid, ok)
      }
      return out
    },
  }
  return Object.assign(store, {
    rows,
    get links() {
      return links
    },
  })
}

/* ---------------- Postgres ---------------- */

interface Row extends Record<string, unknown> {
  id: string
  kind: MediaKind
  mime: string
  size_bytes: string | number
  sha256: string | null
  original_name: string
  title: string | null
  blob_url: string
  variants: unknown
  width: number | null
  height: number | null
  status: MediaStatus
  error: string | null
  created_at: string | Date
  updated_at: string | Date
  deleted_at: string | Date | null
}

const COLS =
  'id, kind, mime, size_bytes, sha256, original_name, title, blob_url, variants, width, height, status, error, created_at, updated_at, deleted_at'
const MCOLS = COLS.split(', ')
  .map((c) => `m.${c}`)
  .join(', ')

function fromRow(r: Row): MediaRecord {
  return {
    id: r.id,
    kind: r.kind,
    mime: r.mime,
    sizeBytes: Number(r.size_bytes),
    sha256: r.sha256,
    originalName: r.original_name,
    title: r.title,
    blobUrl: r.blob_url,
    variants: r.variants && typeof r.variants === 'object' ? (r.variants as Record<string, MediaVariant>) : {},
    width: r.width,
    height: r.height,
    status: r.status,
    error: r.error,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
    deletedAt: r.deleted_at ? new Date(r.deleted_at).toISOString() : null,
  }
}

const isMissing = (e: unknown) => !!e && typeof e === 'object' && (e as { code?: unknown }).code === '42P01'

export function createPgMediaStore(pool: SqlPool): MediaStore {
  type C = Awaited<ReturnType<SqlPool['connect']>>
  async function run<T>(fn: (c: C) => Promise<T>): Promise<T> {
    const c = await pool.connect()
    try {
      return await fn(c)
    } catch (e) {
      if (isMissing(e)) throw new MediaUnavailableError()
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
  const one = async (c: C, sql: string, params: unknown[]) => {
    const r = (await c.query<Row>(sql, params)).rows[0]
    return r ? fromRow(r) : null
  }
  const linkRows = async (c: C, where: string, params: unknown[]) => {
    const r = await c.query<Row & { product_id: string; media_id: string; role: GalleryRole; position: number }>(
      `SELECT pm.product_id, pm.media_id, pm.role, pm.position, ${MCOLS} FROM product_media pm JOIN media m ON m.id = pm.media_id
       WHERE pm.role IN ('main', 'gallery', 'document') AND ${where}
       ORDER BY pm.product_id, CASE pm.role WHEN 'main' THEN 0 WHEN 'gallery' THEN 1 ELSE 2 END, pm.position`,
      params,
    )
    return r.rows.map((row) => ({
      productId: row.product_id,
      link: { mediaId: row.media_id, role: row.role, position: Number(row.position), media: fromRow(row) },
    }))
  }
  return {
    get: (id) => run((c) => one(c, `SELECT ${COLS} FROM media WHERE id = $1`, [id])),
    findBySha: (sha) => run((c) => one(c, `SELECT ${COLS} FROM media WHERE sha256 = $1 AND deleted_at IS NULL`, [sha])),
    insert: (m) =>
      run(async (c) => {
        const ins = await one(
          c,
          `INSERT INTO media (id, kind, mime, size_bytes, sha256, original_name, blob_url, status, created_by_user_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::bigint, $10::timestamptz, $10::timestamptz)
           ON CONFLICT (id) DO NOTHING RETURNING ${COLS}`,
          [m.id, m.kind, m.mime, m.sizeBytes, m.sha256, m.originalName.slice(0, 255), m.blobUrl, m.status, m.createdByUserId, m.nowIso],
        )
        if (ins) return { record: ins, created: true }
        return { record: (await one(c, `SELECT ${COLS} FROM media WHERE id = $1`, [m.id]))!, created: false }
      }),
    update: (id, p, nowIso) =>
      run((c) =>
        one(
          c,
          `UPDATE media SET
             status = COALESCE($2, status), error = CASE WHEN $3::boolean THEN $4 ELSE error END,
             variants = COALESCE($5::jsonb, variants), width = COALESCE($6, width), height = COALESCE($7, height),
             sha256 = COALESCE($8, sha256), title = CASE WHEN $9::boolean THEN $10 ELSE title END, updated_at = $11::timestamptz
           WHERE id = $1 RETURNING ${COLS}`,
          [
            id,
            p.status ?? null,
            'error' in p,
            p.error ?? null,
            p.variants ? JSON.stringify(p.variants) : null,
            p.width ?? null,
            p.height ?? null,
            p.sha256 ?? null,
            'title' in p,
            p.title ?? null,
            nowIso,
          ],
        ),
      ),
    list: (q) =>
      run(async (c) => {
        const where = [q.trash ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL']
        const params: unknown[] = []
        if (q.kind) {
          params.push(q.kind)
          where.push(`kind = $${params.length}`)
        }
        const needle = q.q?.trim().toLowerCase()
        if (needle) {
          params.push(`%${needle.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`)
          where.push(`(lower(original_name) LIKE $${params.length} OR lower(coalesce(title, '')) LIKE $${params.length})`)
        }
        const w = where.join(' AND ')
        const total = Number((await c.query<{ n: string }>(`SELECT count(*) AS n FROM media WHERE ${w}`, params)).rows[0]!.n)
        const order = `${q.sort === 'size' ? 'size_bytes' : 'created_at'} ${q.dir === 'asc' ? 'ASC' : 'DESC'}, id`
        const rows = await c.query<Row>(
          `SELECT ${COLS} FROM media WHERE ${w} ORDER BY ${order} LIMIT ${q.limit} OFFSET ${q.offset}`,
          params,
        )
        return { total, items: rows.rows.map(fromRow) }
      }),
    usage: (id) =>
      run(async (c) => {
        const r = await c.query<{ product_id: string; role: string; block_id: string; position: number }>(
          `SELECT product_id, role, block_id, position FROM product_media WHERE media_id = $1 ORDER BY product_id, role, position`,
          [id],
        )
        return r.rows.map((x) => ({ productId: x.product_id, role: x.role, blockId: x.block_id, position: Number(x.position) }))
      }),
    trash: (id, unlink, nowIso) =>
      run((c) =>
        tx(c, async () => {
          const cur = await one(c, `SELECT ${COLS} FROM media WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id])
          if (!cur) return 'not_found' as const
          const used = Number(
            (await c.query<{ n: string }>(`SELECT count(*) AS n FROM product_media WHERE media_id = $1`, [id])).rows[0]!.n,
          )
          if (used) {
            if (!unlink) return 'in_use' as const
            await c.query(`DELETE FROM product_media WHERE media_id = $1`, [id])
          }
          await c.query(`UPDATE media SET deleted_at = $2::timestamptz, updated_at = $2::timestamptz WHERE id = $1`, [id, nowIso])
          return 'ok' as const
        }),
      ),
    restore: (id, nowIso) =>
      run((c) =>
        one(
          c,
          `UPDATE media SET deleted_at = NULL, updated_at = $2::timestamptz WHERE id = $1 AND deleted_at IS NOT NULL RETURNING ${COLS}`,
          [id, nowIso],
        ),
      ),
    purge: (id) =>
      run((c) =>
        tx(c, async () => {
          const cur = await one(c, `SELECT ${COLS} FROM media WHERE id = $1 FOR UPDATE`, [id])
          if (!cur) return { result: 'not_found' as const }
          if (!cur.deletedAt) return { result: 'not_trashed' as const }
          const used = Number(
            (await c.query<{ n: string }>(`SELECT count(*) AS n FROM product_media WHERE media_id = $1`, [id])).rows[0]!.n,
          )
          if (used) return { result: 'in_use' as const }
          await c.query(`DELETE FROM media WHERE id = $1`, [id])
          return { result: 'ok' as const, record: cur }
        }),
      ),
    productMedia: (productId) => run(async (c) => (await linkRows(c, 'pm.product_id = $1', [productId])).map((x) => x.link)),
    setProductMedia: (productId, items, scope = 'images') =>
      run((c) =>
        tx(c, async () => {
          await c.query(`DELETE FROM product_media WHERE product_id = $1 AND role = ANY($2::text[])`, [productId, SCOPE_ROLES[scope]])
          let pos = 0
          for (const it of items) {
            await c.query(`INSERT INTO product_media (product_id, media_id, role, block_id, position) VALUES ($1, $2, $3, '', $4)`, [
              productId,
              it.mediaId,
              it.role,
              it.role === 'main' ? 0 : pos++,
            ])
          }
          return (await linkRows(c, 'pm.product_id = $1', [productId])).map((x) => x.link)
        }),
      ),
    allProductImages: () =>
      run(async (c) => {
        const out = new Map<string, ProductMediaLink[]>()
        for (const { productId, link } of await linkRows(
          c,
          `m.deleted_at IS NULL AND m.status = 'ready' AND (m.kind = 'image' OR pm.role = 'document')`,
          [],
        )) {
          out.set(productId, [...(out.get(productId) ?? []), link])
        }
        return out
      }),
  }
}
