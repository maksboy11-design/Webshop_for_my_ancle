/**
 * HTTP раздела «Страницы».
 *  - Публичный GET /api/pages?slug=… — только опубликованная версия (черновики наружу не попадают).
 *  - Админ /api/admin/pages — список, создание, копия, черновик, публикация, корзина, версии.
 * Таблица ещё не создана (миграция 010 не применена) → 503 pages_unavailable; сайт тогда
 * показывает «Научные факты» из исходников.
 */
import { randomUUID } from 'node:crypto'
import { authorizeAdmin, type AdminAuthDeps } from './adminAuth'
import { jsonResponse, readLimitedJson, withCacheEtag } from './http'
import type { Log } from './logger'
import type { MediaStore } from './mediaStore'
import { mediaResolver } from './productsHttp'
import { PagesUnavailableError, type PageStatus, type PageSummary, type PagesStore, type StoredPage } from './pagesStore'
import {
  PAGE_TITLE_MAX,
  checkPageDoc,
  cleanLine,
  emptyPageDoc,
  externalUrls,
  isValidSlug,
  linkedPageIds,
  slugify,
  UUID_RE,
  type PageDoc,
} from '../../src/cms/pageDoc'

export const PUBLIC_PAGES_CACHE = 'public, max-age=0, s-maxage=30, stale-while-revalidate=300'

export interface PublicPagesDeps {
  pages: PagesStore | null
  log: Log
}
export interface AdminPagesDeps extends AdminAuthDeps {
  pages: PagesStore | null
  media: MediaStore | null
  log: Log
}

const errorClass = (e: unknown) => (e instanceof Error ? e.name : typeof e)

function unavailable(error: unknown, log: Log): Response {
  if (error instanceof PagesUnavailableError) {
    log.error('pages_unavailable', { errorClass: 'pages_table_missing' })
    return jsonResponse(503, { error: 'pages_unavailable' })
  }
  log.error('pages_storage_failed', { errorClass: errorClass(error) })
  return jsonResponse(503, { error: 'unavailable' })
}

/** Карта целей кнопок: id → {slug,title,status}. Публично — только опубликованные. */
async function linkMap(store: PagesStore, docs: (PageDoc | null)[], publicOnly: boolean) {
  const ids = [...new Set(docs.flatMap((d) => linkedPageIds(d)))]
  const out: Record<string, { slug: string; title: string; status: PageStatus; deleted: boolean }> = {}
  for (const p of await store.lookup(ids)) {
    if (publicOnly && (p.status !== 'published' || p.deletedAt)) continue
    out[p.id] = { slug: p.slug, title: p.title, status: p.status, deleted: !!p.deletedAt }
  }
  return out
}

export async function handlePublicPagesRequest(request: Request, deps: PublicPagesDeps): Promise<Response> {
  if (request.method !== 'GET') return jsonResponse(405, { error: 'method_not_allowed' }, { allow: 'GET' })
  const slug = new URL(request.url).searchParams.get('slug') ?? ''
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return jsonResponse(400, { error: 'invalid', field: 'slug' })
  if (!deps.pages) return jsonResponse(503, { error: 'pages_unavailable' })
  try {
    const p = await deps.pages.getBySlug(slug)
    if (!p || p.status !== 'published' || !p.published)
      return jsonResponse(404, { error: 'not_found' }, { 'cache-control': 'public, max-age=0, s-maxage=10' })
    const body = {
      page: { id: p.id, slug: p.slug, title: p.publishedTitle ?? p.title, doc: p.published, publishedAt: p.publishedAt },
      links: await linkMap(deps.pages, [p.published], true),
    }
    return withCacheEtag(request, body, PUBLIC_PAGES_CACHE, `${p.id}:${p.publishedAt ?? p.updatedAt}`)
  } catch (e) {
    return unavailable(e, deps.log)
  }
}

function view(p: StoredPage) {
  return {
    id: p.id,
    title: p.title,
    slug: p.slug,
    status: p.status,
    doc: p.draft,
    rev: p.draftRev,
    hasPublished: !!p.published,
    changed: p.status === 'published' && (JSON.stringify(p.draft) !== JSON.stringify(p.published) || p.title !== p.publishedTitle),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    publishedAt: p.publishedAt,
    deletedAt: p.deletedAt,
  }
}

async function uniqueSlug(store: PagesStore, base: string, exceptId?: string): Promise<string> {
  const root = isValidSlug(base) ? base : `${base}-page`.replace(/^-+/, '')
  let s = root
  for (let n = 2; (await store.slugTaken(s, exceptId)) || !isValidSlug(s); n++) s = `${root.slice(0, 74)}-${n}`
  return s
}

/** Предупреждения перед публикацией: кнопки на неопубликованные/удалённые страницы. */
function linkWarnings(doc: PageDoc, links: Awaited<ReturnType<typeof linkMap>>) {
  const out: { blockId: string; pageId: string; problem: 'unpublished' | 'deleted' | 'missing' }[] = []
  for (const b of doc.blocks) {
    if (b.type !== 'button' || b.target.kind !== 'page') continue
    const l = links[b.target.pageId]
    const problem = !l ? 'missing' : l.deleted ? 'deleted' : l.status !== 'published' ? 'unpublished' : null
    if (problem) out.push({ blockId: b.id, pageId: b.target.pageId, problem })
  }
  return out
}

const ALLOW = 'GET, POST, PUT, DELETE'

export async function handleAdminPagesRequest(request: Request, deps: AdminPagesDeps): Promise<Response> {
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(request.method))
    return jsonResponse(405, { error: 'method_not_allowed' }, { allow: ALLOW })
  const auth = authorizeAdmin(request, deps)
  if (!auth.ok) return jsonResponse(auth.status, { error: auth.error })
  const store = deps.pages
  if (!store) return jsonResponse(503, { error: 'pages_unavailable' })
  const q = new URL(request.url).searchParams
  const userId = auth.userId
  const now = () => deps.now().toISOString()
  const idParam = (name: string) => {
    const v = q.get(name)
    return v && UUID_RE.test(v) ? v.toLowerCase() : null
  }
  const readBody = async (): Promise<Record<string, unknown> | Response> => {
    const b = await readLimitedJson(request)
    if (!b.ok) return jsonResponse(b.status, { error: 'bad_request' })
    if (!b.value || typeof b.value !== 'object' || Array.isArray(b.value)) return jsonResponse(400, { error: 'bad_request' })
    return b.value as Record<string, unknown>
  }
  const done = async (r: Awaited<ReturnType<PagesStore['publish']>>, extra: Record<string, unknown> = {}) => {
    if (r.ok) return jsonResponse(200, { page: view(r.value), ...extra })
    if (r.error === 'conflict') return jsonResponse(409, { error: 'conflict', page: view(r.current) })
    if (r.error === 'slug_taken') return jsonResponse(409, { error: 'slug_taken', field: 'slug' })
    return jsonResponse(404, { error: 'not_found' })
  }

  try {
    if (request.method === 'GET') {
      if (q.get('list') === '1') {
        const status = q.get('status')
        const offset = Math.max(0, Math.min(10_000, Number(q.get('offset')) || 0))
        const limit = Math.max(1, Math.min(100, Number(q.get('limit')) || 20))
        return jsonResponse(
          200,
          await store.list({
            q: cleanLine(q.get('q'), 100),
            status: status === 'draft' || status === 'published' ? status : 'all',
            trash: q.get('trash') === '1',
            offset,
            limit,
          }),
        )
      }
      const vid = idParam('versions')
      if (vid) {
        const rev = Number(q.get('rev'))
        if (Number.isInteger(rev) && rev > 0) {
          const v = await store.version(vid, rev)
          return v ? jsonResponse(200, { version: v }) : jsonResponse(404, { error: 'not_found' })
        }
        return jsonResponse(200, { versions: await store.versions(vid) })
      }
      const id = idParam('id')
      if (id) {
        const p = await store.get(id)
        if (!p) return jsonResponse(404, { error: 'not_found' })
        return jsonResponse(200, {
          page: view(p),
          links: await linkMap(store, [p.draft], false),
          referencedBy: (await store.referencing(id)).map(brief),
        })
      }
      return jsonResponse(400, { error: 'bad_request' })
    }

    if (request.method === 'POST' && q.get('create') === '1') {
      const b = await readBody()
      if (b instanceof Response) return b
      const title = cleanLine(b.title, PAGE_TITLE_MAX) || 'Новая страница'
      const wanted = typeof b.slug === 'string' && b.slug ? b.slug : slugify(title)
      if (typeof b.slug === 'string' && b.slug && !isValidSlug(b.slug)) return jsonResponse(400, { error: 'invalid_slug', field: 'slug' })
      const slug = await uniqueSlug(store, wanted)
      const r = await store.create({ id: randomUUID(), title, slug, draft: emptyPageDoc(), userId, nowIso: now() })
      deps.log.info('admin_page_created')
      return r.ok ? jsonResponse(201, { page: view(r.value) }) : done(r)
    }

    const dup = idParam('duplicate')
    if (request.method === 'POST' && dup) {
      const src = await store.get(dup)
      if (!src || src.deletedAt) return jsonResponse(404, { error: 'not_found' })
      const title = `${src.title} (копия)`.slice(0, PAGE_TITLE_MAX)
      const r = await store.create({
        id: randomUUID(),
        title,
        slug: await uniqueSlug(store, `${src.slug}-copy`),
        draft: src.draft,
        userId,
        nowIso: now(),
      })
      return r.ok ? jsonResponse(201, { page: view(r.value) }) : done(r)
    }

    const putId = idParam('id')
    if (request.method === 'PUT' && putId) {
      const b = await readBody()
      if (b instanceof Response) return b
      if (!Number.isInteger(b.rev) || (b.rev as number) < 0) return jsonResponse(400, { error: 'invalid', field: 'rev' })
      const title = cleanLine(b.title, PAGE_TITLE_MAX)
      if (!title) return jsonResponse(400, { error: 'empty_title', field: 'title' })
      const slug = typeof b.slug === 'string' ? b.slug : ''
      if (!isValidSlug(slug)) return jsonResponse(400, { error: 'invalid_slug', field: 'slug' })
      const cur = await store.get(putId)
      if (!cur || cur.deletedAt) return jsonResponse(404, { error: 'not_found' })
      // Внешние ссылки нельзя добавить из редактора — только сохранить уже существующие (перенесённые).
      const allowed = new Set([...externalUrls(cur.draft), ...externalUrls(cur.published)])
      const checked = await checkPageDoc(b.doc, mediaResolver(deps.media), { allowedExternal: allowed })
      if (!checked.ok) return jsonResponse(400, { error: checked.error, field: checked.field })
      if (linkedPageIds(checked.value).includes(putId)) return jsonResponse(400, { error: 'self_link', field: 'doc' })
      const r = await store.saveDraft(putId, {
        title,
        slug,
        draft: checked.value,
        expectedRev: b.rev as number,
        userId,
        nowIso: now(),
        version: b.version === true,
      })
      if (r.ok) deps.log.info('admin_page_draft_saved')
      return done(r)
    }

    const pub = idParam('publish')
    if (request.method === 'POST' && pub) {
      const cur = await store.get(pub)
      if (!cur || cur.deletedAt) return jsonResponse(404, { error: 'not_found' })
      const warnings = linkWarnings(cur.draft, await linkMap(store, [cur.draft], false))
      const r = await store.publish(pub, userId, now())
      if (r.ok) deps.log.info('admin_page_published')
      return done(r, { warnings })
    }
    const unpub = idParam('unpublish')
    if (request.method === 'POST' && unpub) {
      const refs = (await store.referencing(unpub)).map(brief)
      return done(await store.unpublish(unpub, userId, now()), { referencedBy: refs })
    }
    const rest = idParam('restore')
    if (request.method === 'POST' && rest) return done(await store.restore(rest, userId, now()))
    const rv = idParam('restoreVersion')
    if (request.method === 'POST' && rv) {
      const rev = Number(q.get('rev'))
      if (!Number.isInteger(rev) || rev < 1) return jsonResponse(400, { error: 'invalid', field: 'rev' })
      return done(await store.restoreVersion(rv, rev, userId, now()))
    }

    const del = idParam('id')
    if (request.method === 'DELETE' && del) {
      // На страницу ведут кнопки других страниц — без явного подтверждения в корзину не убираем.
      const refs = (await store.referencing(del)).map(brief)
      if (refs.length && q.get('force') !== '1') return jsonResponse(409, { error: 'referenced', referencedBy: refs })
      return done(await store.trash(del, userId, now()), { referencedBy: refs })
    }

    return jsonResponse(400, { error: 'bad_request' })
  } catch (e) {
    return unavailable(e, deps.log)
  }
}

const brief = (p: PageSummary) => ({ id: p.id, title: p.title, slug: p.slug, status: p.status })
