/**
 * Хранилище раздела «Страницы» (таблицы pages / page_versions, миграция 010).
 * Черновик (draft) и опубликованная версия (published) хранятся раздельно; публикация — только явным действием.
 * Если миграция 010 ещё не применена (42P01), методы бросают PagesUnavailableError → HTTP 503,
 * а сайт продолжает показывать «Научные факты» из исходников.
 */
import { emptyPageDoc, sanitizePublicPageDoc, type PageDoc } from '../../src/cms/pageDoc'
import type { SqlPool } from './postgresStore'

export const PAGE_VERSIONS_KEEP = 30

export type PageStatus = 'draft' | 'published'
export interface StoredPage {
  id: string
  title: string
  slug: string
  status: PageStatus
  draft: PageDoc
  published: PageDoc | null
  publishedTitle: string | null
  schemaVersion: number
  draftRev: number
  createdAt: string
  updatedAt: string
  publishedAt: string | null
  deletedAt: string | null
}
export interface PageSummary {
  id: string
  title: string
  slug: string
  status: PageStatus
  /** Черновик отличается от опубликованного. */
  changed: boolean
  createdAt: string
  updatedAt: string
  publishedAt: string | null
  deletedAt: string | null
}
export interface PageVersionInfo {
  rev: number
  reason: string
  title: string
  restoredFromRev: number | null
  createdAt: string
}
export interface PageSnapshot {
  title: string
  slug: string
  doc: PageDoc
}
export interface ListQuery {
  q: string
  status: PageStatus | 'all'
  trash: boolean
  offset: number
  limit: number
}

export class PagesUnavailableError extends Error {
  constructor() {
    super('pages table is missing')
    this.name = 'PagesUnavailableError'
  }
}

export type WriteResult =
  { ok: true; value: StoredPage } | { ok: false; error: 'conflict'; current: StoredPage } | { ok: false; error: 'slug_taken' | 'not_found' }

export interface PagesStore {
  list(q: ListQuery): Promise<{ items: PageSummary[]; total: number }>
  get(id: string): Promise<StoredPage | null>
  /** Неудалённая страница по слагу (для публичного API: дальше проверяется published). */
  getBySlug(slug: string): Promise<StoredPage | null>
  slugTaken(slug: string, exceptId?: string): Promise<boolean>
  /** Короткий список страниц для выбора цели кнопки и проверки ссылок. */
  lookup(ids: readonly string[]): Promise<PageSummary[]>
  create(p: { id: string; title: string; slug: string; draft: PageDoc; userId: string; nowIso: string }): Promise<WriteResult>
  saveDraft(
    id: string,
    p: { title: string; slug: string; draft: PageDoc; expectedRev: number; userId: string; nowIso: string; version: boolean },
  ): Promise<WriteResult>
  publish(id: string, userId: string, nowIso: string): Promise<WriteResult>
  unpublish(id: string, userId: string, nowIso: string): Promise<WriteResult>
  trash(id: string, userId: string, nowIso: string): Promise<WriteResult>
  restore(id: string, userId: string, nowIso: string): Promise<WriteResult>
  versions(id: string): Promise<PageVersionInfo[]>
  version(id: string, rev: number): Promise<PageSnapshot | null>
  /** Вернуть версию в черновик; создаёт новую версию (reason=restore). */
  restoreVersion(id: string, rev: number, userId: string, nowIso: string): Promise<WriteResult>
  /** Неудалённые страницы, у которых кнопки (черновик или опубликованное) ведут на pageId. */
  referencing(pageId: string): Promise<PageSummary[]>
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
function summary(p: StoredPage): PageSummary {
  return {
    id: p.id,
    title: p.title,
    slug: p.slug,
    status: p.status,
    changed: p.status === 'published' && (!same(p.draft, p.published) || p.title !== p.publishedTitle),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    publishedAt: p.publishedAt,
    deletedAt: p.deletedAt,
  }
}
const refersTo = (doc: PageDoc | null, pageId: string) =>
  !!doc?.blocks.some((b) => b.type === 'button' && b.target.kind === 'page' && b.target.pageId === pageId)

/* ---------------------------------- память ---------------------------------- */

export function createMemoryPagesStore(): PagesStore & { activity: string[]; pages: Map<string, StoredPage> } {
  const pages = new Map<string, StoredPage>()
  const versions = new Map<string, (PageVersionInfo & { snap: PageSnapshot })[]>()
  const activity: string[] = []
  const clone = <T>(v: T): T => structuredClone(v)
  const live = () => [...pages.values()].filter((p) => !p.deletedAt)
  const addVersion = (p: StoredPage, reason: string, nowIso: string, from: number | null = null) => {
    const list = versions.get(p.id) ?? []
    const rev = (list.at(-1)?.rev ?? 0) + 1
    list.push({
      rev,
      reason,
      title: p.title,
      restoredFromRev: from,
      createdAt: nowIso,
      snap: clone({ title: p.title, slug: p.slug, doc: p.draft }),
    })
    while (list.length > PAGE_VERSIONS_KEEP) list.shift()
    versions.set(p.id, list)
    return rev
  }
  const touch = (id: string, fn: (p: StoredPage) => void, action: string): WriteResult => {
    const p = pages.get(id)
    if (!p) return { ok: false, error: 'not_found' }
    fn(p)
    activity.push(`${action}:${id}`)
    return { ok: true, value: clone(p) }
  }
  const store: PagesStore = {
    async list(q) {
      const needle = q.q.trim().toLowerCase()
      const all = [...pages.values()]
        .filter((p) => (q.trash ? !!p.deletedAt : !p.deletedAt))
        .filter((p) => q.status === 'all' || p.status === q.status)
        .filter((p) => !needle || p.title.toLowerCase().includes(needle) || p.slug.includes(needle))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      return { items: all.slice(q.offset, q.offset + q.limit).map(summary), total: all.length }
    },
    async get(id) {
      const p = pages.get(id)
      return p ? clone(p) : null
    },
    async getBySlug(slug) {
      const p = live().find((x) => x.slug === slug)
      return p ? clone(p) : null
    },
    async slugTaken(slug, exceptId) {
      return live().some((p) => p.slug === slug && p.id !== exceptId)
    },
    async lookup(ids) {
      return ids
        .map((id) => pages.get(id))
        .filter((p): p is StoredPage => !!p)
        .map(summary)
    },
    async create({ id, title, slug, draft, nowIso }) {
      if (await store.slugTaken(slug)) return { ok: false, error: 'slug_taken' }
      const p: StoredPage = {
        id,
        title,
        slug,
        status: 'draft',
        draft: clone(draft),
        published: null,
        publishedTitle: null,
        schemaVersion: 1,
        draftRev: 1,
        createdAt: nowIso,
        updatedAt: nowIso,
        publishedAt: null,
        deletedAt: null,
      }
      pages.set(id, p)
      addVersion(p, 'save', nowIso)
      activity.push(`page_create:${id}`)
      return { ok: true, value: clone(p) }
    },
    async saveDraft(id, { title, slug, draft, expectedRev, nowIso, version }) {
      const p = pages.get(id)
      if (!p || p.deletedAt) return { ok: false, error: 'not_found' }
      if (p.draftRev !== expectedRev) return { ok: false, error: 'conflict', current: clone(p) }
      if (await store.slugTaken(slug, id)) return { ok: false, error: 'slug_taken' }
      Object.assign(p, { title, slug, draft: clone(draft), draftRev: p.draftRev + 1, updatedAt: nowIso })
      if (version) addVersion(p, 'save', nowIso)
      activity.push(`page_save:${id}`)
      return { ok: true, value: clone(p) }
    },
    async publish(id, _u, nowIso) {
      const p = pages.get(id)
      if (!p || p.deletedAt) return { ok: false, error: 'not_found' }
      return touch(
        id,
        (x) => {
          Object.assign(x, {
            published: clone(x.draft),
            publishedTitle: x.title,
            status: 'published',
            publishedAt: nowIso,
            updatedAt: nowIso,
          })
          addVersion(x, 'publish', nowIso)
        },
        'page_publish',
      )
    },
    async unpublish(id, _u, nowIso) {
      const p = pages.get(id)
      if (!p || p.deletedAt) return { ok: false, error: 'not_found' }
      return touch(id, (x) => Object.assign(x, { status: 'draft', updatedAt: nowIso }), 'page_unpublish')
    },
    async trash(id, _u, nowIso) {
      return touch(id, (x) => Object.assign(x, { deletedAt: nowIso, updatedAt: nowIso }), 'page_trash')
    },
    async restore(id, _u, nowIso) {
      const p = pages.get(id)
      if (!p) return { ok: false, error: 'not_found' }
      if (await store.slugTaken(p.slug, id)) return { ok: false, error: 'slug_taken' }
      return touch(id, (x) => Object.assign(x, { deletedAt: null, updatedAt: nowIso }), 'page_restore')
    },
    async versions(id) {
      return (versions.get(id) ?? []).map(({ snap: _s, ...v }) => v).reverse() // eslint-disable-line @typescript-eslint/no-unused-vars
    },
    async version(id, rev) {
      const v = (versions.get(id) ?? []).find((x) => x.rev === rev)
      return v ? clone(v.snap) : null
    },
    async restoreVersion(id, rev, _u, nowIso) {
      const p = pages.get(id)
      const v = (versions.get(id) ?? []).find((x) => x.rev === rev)
      if (!p || p.deletedAt || !v) return { ok: false, error: 'not_found' }
      if (await store.slugTaken(v.snap.slug, id)) return { ok: false, error: 'slug_taken' }
      Object.assign(p, { title: v.snap.title, slug: v.snap.slug, draft: clone(v.snap.doc), draftRev: p.draftRev + 1, updatedAt: nowIso })
      addVersion(p, 'restore', nowIso, rev)
      activity.push(`page_version_restore:${id}`)
      return { ok: true, value: clone(p) }
    },
    async referencing(pageId) {
      return live()
        .filter((p) => p.id !== pageId && (refersTo(p.draft, pageId) || refersTo(p.published, pageId)))
        .map(summary)
    },
  }
  return Object.assign(store, { activity, pages })
}

/* --------------------------------- Postgres --------------------------------- */

const isMissing = (e: unknown) => !!e && typeof e === 'object' && (e as { code?: unknown }).code === '42P01'
const isUnique = (e: unknown) => !!e && typeof e === 'object' && (e as { code?: unknown }).code === '23505'

interface Row extends Record<string, unknown> {
  id: string
  title: string
  slug: string
  status: string
  draft: unknown
  published: unknown
  published_title: string | null
  schema_version: number
  draft_rev: number
  created_at: string | Date
  updated_at: string | Date
  published_at: string | Date | null
  deleted_at: string | Date | null
}
const COLS =
  'id, title, slug, status, draft, published, published_title, schema_version, draft_rev, created_at, updated_at, published_at, deleted_at'
const iso = (v: string | Date | null) => (v ? new Date(v).toISOString() : null)
function fromRow(r: Row): StoredPage {
  return {
    id: String(r.id),
    title: r.title,
    slug: r.slug,
    status: r.status === 'published' ? 'published' : 'draft',
    draft: sanitizePublicPageDoc(r.draft) ?? emptyPageDoc(),
    published: r.published ? sanitizePublicPageDoc(r.published) : null,
    publishedTitle: r.published_title,
    schemaVersion: Number(r.schema_version),
    draftRev: Number(r.draft_rev),
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    publishedAt: iso(r.published_at),
    deletedAt: iso(r.deleted_at),
  }
}

export function createPgPagesStore(pool: SqlPool): PagesStore {
  type C = Awaited<ReturnType<SqlPool['connect']>>
  async function run<T>(fn: (c: C) => Promise<T>): Promise<T> {
    const c = await pool.connect()
    try {
      return await fn(c)
    } catch (e) {
      if (isMissing(e)) throw new PagesUnavailableError()
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
  const row = async (c: C, id: string, lock = false) =>
    (await c.query<Row>(`SELECT ${COLS} FROM pages WHERE id = $1::uuid${lock ? ' FOR UPDATE' : ''}`, [id])).rows[0]
  const log = (c: C, action: string, id: string, userId: string, nowIso: string, details: Record<string, unknown> = {}) =>
    c.query(
      `INSERT INTO cms_activity_log (at, user_id, action, entity_type, entity_id, details) VALUES ($1::timestamptz, $2::bigint, $3, 'page', $4, $5::jsonb)`,
      [nowIso, userId, action, id, JSON.stringify(details)],
    )
  const addVersion = async (c: C, p: StoredPage, reason: string, userId: string, nowIso: string, from: number | null = null) => {
    const rev = Number(
      (await c.query<{ n: number }>(`SELECT COALESCE(MAX(rev), 0) + 1 AS n FROM page_versions WHERE page_id = $1::uuid`, [p.id])).rows[0]!
        .n,
    )
    await c.query(
      `INSERT INTO page_versions (page_id, rev, title, snapshot, reason, restored_from_rev, created_by_user_id, created_at)
       VALUES ($1::uuid, $2, $3, $4::jsonb, $5, $6, $7::bigint, $8::timestamptz)`,
      [p.id, rev, p.title, JSON.stringify({ title: p.title, slug: p.slug, doc: p.draft }), reason, from, userId, nowIso],
    )
    // Ограниченная история: старые версии сверх лимита удаляются (публикации не трогаем, только «save»).
    await c.query(`DELETE FROM page_versions WHERE page_id = $1::uuid AND reason = 'save' AND rev <= $2::int - $3::int`, [
      p.id,
      rev,
      PAGE_VERSIONS_KEEP,
    ])
    return rev
  }
  const write = (
    id: string,
    action: string,
    userId: string,
    nowIso: string,
    sql: string,
    values: unknown[],
    after?: (c: C, p: StoredPage) => Promise<void>,
  ) =>
    run((c) =>
      tx(c, async (): Promise<WriteResult> => {
        const cur = await row(c, id, true)
        if (!cur) return { ok: false, error: 'not_found' }
        const w = await c.query<Row>(`UPDATE pages SET ${sql} WHERE id = $1::uuid RETURNING ${COLS}`, [id, ...values])
        const p = fromRow(w.rows[0]!)
        if (after) await after(c, p)
        await log(c, action, id, userId, nowIso)
        return { ok: true, value: p }
      }),
    )
  const store: PagesStore = {
    list: (q) =>
      run(async (c) => {
        const where = [q.trash ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL']
        const vals: unknown[] = []
        if (q.status !== 'all') where.push(`status = $${vals.push(q.status)}`)
        if (q.q.trim())
          where.push(`(title ILIKE $${vals.push(`%${q.q.trim().replace(/[\\%_]/g, '\\$&')}%`)} OR slug ILIKE $${vals.length})`)
        const w = where.join(' AND ')
        const total = Number((await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM pages WHERE ${w}`, vals)).rows[0]!.n)
        const r = await c.query<Row>(
          `SELECT ${COLS} FROM pages WHERE ${w} ORDER BY updated_at DESC LIMIT ${q.limit} OFFSET ${q.offset}`,
          vals,
        )
        return { items: r.rows.map((x) => summary(fromRow(x))), total }
      }),
    get: (id) =>
      run(async (c) => {
        const r = await row(c, id)
        return r ? fromRow(r) : null
      }),
    getBySlug: (slug) =>
      run(async (c) => {
        const r = (await c.query<Row>(`SELECT ${COLS} FROM pages WHERE slug = $1 AND deleted_at IS NULL`, [slug])).rows[0]
        return r ? fromRow(r) : null
      }),
    slugTaken: (slug, exceptId) =>
      run(async (c) => {
        const r = await c.query(`SELECT 1 FROM pages WHERE slug = $1 AND deleted_at IS NULL AND ($2::uuid IS NULL OR id <> $2::uuid)`, [
          slug,
          exceptId ?? null,
        ])
        return r.rows.length > 0
      }),
    lookup: (ids) =>
      ids.length
        ? run(async (c) =>
            (await c.query<Row>(`SELECT ${COLS} FROM pages WHERE id = ANY($1::uuid[])`, [ids])).rows.map((x) => summary(fromRow(x))),
          )
        : Promise.resolve([]),
    create: ({ id, title, slug, draft, userId, nowIso }) =>
      run((c) =>
        tx(c, async (): Promise<WriteResult> => {
          try {
            await c.query('SAVEPOINT ins')
            const w = await c.query<Row>(
              `INSERT INTO pages (id, title, slug, status, draft, draft_rev, created_by_user_id, updated_by_user_id, created_at, updated_at)
               VALUES ($1::uuid, $2, $3, 'draft', $4::jsonb, 1, $5::bigint, $5::bigint, $6::timestamptz, $6::timestamptz) RETURNING ${COLS}`,
              [id, title, slug, JSON.stringify(draft), userId, nowIso],
            )
            const p = fromRow(w.rows[0]!)
            await addVersion(c, p, 'save', userId, nowIso)
            await log(c, 'page_create', id, userId, nowIso, { slug })
            return { ok: true, value: p }
          } catch (e) {
            if (isUnique(e)) {
              await c.query('ROLLBACK TO SAVEPOINT ins')
              return { ok: false, error: 'slug_taken' }
            }
            throw e
          }
        }),
      ),
    saveDraft: (id, { title, slug, draft, expectedRev, userId, nowIso, version }) =>
      run((c) =>
        tx(c, async (): Promise<WriteResult> => {
          const cur = await row(c, id, true)
          if (!cur || cur.deleted_at) return { ok: false, error: 'not_found' }
          if (Number(cur.draft_rev) !== expectedRev) return { ok: false, error: 'conflict', current: fromRow(cur) }
          const taken = await c.query(`SELECT 1 FROM pages WHERE slug = $1 AND deleted_at IS NULL AND id <> $2::uuid`, [slug, id])
          if (taken.rows.length) return { ok: false, error: 'slug_taken' }
          const w = await c.query<Row>(
            `UPDATE pages SET title = $2, slug = $3, draft = $4::jsonb, draft_rev = draft_rev + 1, updated_at = $5::timestamptz, updated_by_user_id = $6::bigint
             WHERE id = $1::uuid RETURNING ${COLS}`,
            [id, title, slug, JSON.stringify(draft), nowIso, userId],
          )
          const p = fromRow(w.rows[0]!)
          if (version) {
            await addVersion(c, p, 'save', userId, nowIso)
            await log(c, 'page_save', id, userId, nowIso, { draft_rev: p.draftRev })
          }
          return { ok: true, value: p }
        }),
      ),
    publish: (id, userId, nowIso) =>
      write(
        id,
        'page_publish',
        userId,
        nowIso,
        `published = draft, published_title = title, status = 'published', published_at = $2::timestamptz, updated_at = $2::timestamptz, updated_by_user_id = $3::bigint`,
        [nowIso, userId],
        async (c, p) => void (await addVersion(c, p, 'publish', userId, nowIso)),
      ),
    unpublish: (id, userId, nowIso) =>
      write(id, 'page_unpublish', userId, nowIso, `status = 'draft', updated_at = $2::timestamptz, updated_by_user_id = $3::bigint`, [
        nowIso,
        userId,
      ]),
    trash: (id, userId, nowIso) =>
      write(
        id,
        'page_trash',
        userId,
        nowIso,
        `deleted_at = $2::timestamptz, updated_at = $2::timestamptz, updated_by_user_id = $3::bigint`,
        [nowIso, userId],
      ),
    restore: (id, userId, nowIso) =>
      run(async (c) => {
        const cur = await row(c, id)
        if (!cur) return { ok: false, error: 'not_found' } as const
        if (await store.slugTaken(cur.slug, id)) return { ok: false, error: 'slug_taken' } as const
        return write(
          id,
          'page_restore',
          userId,
          nowIso,
          `deleted_at = NULL, updated_at = $2::timestamptz, updated_by_user_id = $3::bigint`,
          [nowIso, userId],
        )
      }),
    versions: (id) =>
      run(async (c) =>
        (
          await c.query<{ rev: number; reason: string; title: string; restored_from_rev: number | null; created_at: string | Date }>(
            `SELECT rev, reason, title, restored_from_rev, created_at FROM page_versions WHERE page_id = $1::uuid ORDER BY rev DESC LIMIT ${PAGE_VERSIONS_KEEP * 2}`,
            [id],
          )
        ).rows.map((v) => ({
          rev: Number(v.rev),
          reason: v.reason,
          title: v.title,
          restoredFromRev: v.restored_from_rev,
          createdAt: iso(v.created_at)!,
        })),
      ),
    version: (id, rev) =>
      run(async (c) => {
        const r = (
          await c.query<{ snapshot: Record<string, unknown> }>(`SELECT snapshot FROM page_versions WHERE page_id = $1::uuid AND rev = $2`, [
            id,
            rev,
          ])
        ).rows[0]
        if (!r) return null
        return {
          title: String(r.snapshot.title ?? ''),
          slug: String(r.snapshot.slug ?? ''),
          doc: sanitizePublicPageDoc(r.snapshot.doc) ?? emptyPageDoc(),
        }
      }),
    restoreVersion: (id, rev, userId, nowIso) =>
      run((c) =>
        tx(c, async (): Promise<WriteResult> => {
          const cur = await row(c, id, true)
          const v = (
            await c.query<{ snapshot: Record<string, unknown> }>(
              `SELECT snapshot FROM page_versions WHERE page_id = $1::uuid AND rev = $2`,
              [id, rev],
            )
          ).rows[0]
          if (!cur || cur.deleted_at || !v) return { ok: false, error: 'not_found' }
          const slug = String(v.snapshot.slug ?? cur.slug)
          const taken = await c.query(`SELECT 1 FROM pages WHERE slug = $1 AND deleted_at IS NULL AND id <> $2::uuid`, [slug, id])
          if (taken.rows.length) return { ok: false, error: 'slug_taken' }
          const w = await c.query<Row>(
            `UPDATE pages SET title = $2, slug = $3, draft = $4::jsonb, draft_rev = draft_rev + 1, updated_at = $5::timestamptz, updated_by_user_id = $6::bigint
             WHERE id = $1::uuid RETURNING ${COLS}`,
            [id, String(v.snapshot.title ?? cur.title), slug, JSON.stringify(v.snapshot.doc ?? emptyPageDoc()), nowIso, userId],
          )
          const p = fromRow(w.rows[0]!)
          await addVersion(c, p, 'restore', userId, nowIso, rev)
          await log(c, 'page_version_restore', id, userId, nowIso, { from_rev: rev })
          return { ok: true, value: p }
        }),
      ),
    referencing: (pageId) =>
      run(async (c) => {
        const like = `%${pageId}%`
        const r = await c.query<Row>(
          `SELECT ${COLS} FROM pages WHERE deleted_at IS NULL AND id <> $1::uuid AND (draft::text LIKE $2 OR coalesce(published::text, '') LIKE $2)`,
          [pageId, like],
        )
        return r.rows
          .map(fromRow)
          .filter((p) => refersTo(p.draft, pageId) || refersTo(p.published, pageId))
          .map(summary)
      }),
  }
  return store
}
