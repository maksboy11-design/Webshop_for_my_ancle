/**
 * Ссылки на медиа изнутри контента (блоки и видео описания товара, блоки страниц).
 * Такие ссылки живут в jsonb черновика/опубликованной версии, а не в product_media, поэтому
 * медиатека спрашивает их отдельно: файл, на который ссылается контент, считается «используемым»
 * и не уходит в корзину и не удаляется навсегда.
 */
import type { MediaUsage } from './mediaStore'
import type { SqlPool } from './postgresStore'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Все mediaId внутри произвольного JSON (ключ mediaId на любой глубине). */
export function collectMediaIds(v: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(v)) for (const x of v) collectMediaIds(x, out)
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === 'mediaId' && typeof x === 'string' && UUID.test(x)) out.add(x.toLowerCase())
      else collectMediaIds(x, out)
    }
  }
  return out
}

export interface ContentRow {
  kind: 'product' | 'page'
  id: string
  title?: string
  draft: unknown
  published: unknown
}

/** Использования одного файла по набору строк контента. */
export function usageFromRows(mediaId: string, rows: readonly ContentRow[]): MediaUsage[] {
  const id = mediaId.toLowerCase()
  const out: MediaUsage[] = []
  for (const r of rows) {
    const inDraft = collectMediaIds(r.draft).has(id)
    const inPub = collectMediaIds(r.published).has(id)
    if (!inDraft && !inPub) continue
    const role = `${r.kind === 'page' ? 'page' : 'content'}_${inPub ? 'published' : 'draft'}`
    out.push(
      r.kind === 'page'
        ? { productId: '', pageId: r.id, title: r.title ?? '', role, blockId: '', position: 0 }
        : { productId: r.id, role, blockId: '', position: 0 },
    )
  }
  return out
}

export type ContentUsage = (mediaId: string) => Promise<MediaUsage[]>

const isMissing = (e: unknown) => !!e && typeof e === 'object' && (e as { code?: unknown }).code === '42P01'

/** Postgres: product_content (007) и pages (010). Отсутствующая таблица — просто нет ссылок. */
export function pgContentUsage(pool: SqlPool): ContentUsage {
  return async (mediaId) => {
    if (!UUID.test(mediaId)) return []
    const like = `%${mediaId.toLowerCase()}%`
    const c = await pool.connect()
    try {
      const rows: ContentRow[] = []
      const q = async (sql: string, map: (r: Record<string, unknown>) => ContentRow) => {
        try {
          for (const r of (await c.query(sql, [like])).rows) rows.push(map(r))
        } catch (e) {
          if (!isMissing(e)) throw e
        }
      }
      await q(
        `SELECT product_id, draft, published FROM product_content
          WHERE deleted_at IS NULL AND (lower(draft::text) LIKE $1 OR lower(coalesce(published::text, '')) LIKE $1)`,
        (r) => ({ kind: 'product', id: String(r.product_id), draft: r.draft, published: r.published }),
      )
      await q(
        `SELECT id, title, draft, published FROM pages
          WHERE deleted_at IS NULL AND (lower(draft::text) LIKE $1 OR lower(coalesce(published::text, '')) LIKE $1)`,
        (r) => ({ kind: 'page', id: String(r.id), title: String(r.title ?? ''), draft: r.draft, published: r.published }),
      )
      return usageFromRows(mediaId, rows)
    } finally {
      c.release()
    }
  }
}
