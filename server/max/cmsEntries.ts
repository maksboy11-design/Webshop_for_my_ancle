/**
 * Записи, добавленные модератором вручную в Mini App («Добавить»): товары, отзывы, вебинары.
 * Черновик — пока не заполнено хотя бы одно обязательное поле (на сайте не виден).
 * Когда все обязательные поля заполнены — запись публикуется автоматически.
 * Хранилище — таблица cms_entries (миграция 006). Пока миграция не применена, всё работает как раньше:
 * публичные API просто не добавляют ручные записи, а админ-API отвечает 503 migration_pending.
 */
import type { SqlPool } from './postgresStore'
import { findProduct } from './catalog'
import { YOUTUBE_ID, parseYoutubeUrl } from './youtubeImport'
import { BRAND_LABELS } from '../../src/content/copy'

export type EntryKind = 'product' | 'review' | 'webinar'
export type EntryStatus = 'draft' | 'published' | 'withdrawn'
export type WebinarCategory = 'products' | 'doctors'
export const ENTRY_KINDS: readonly EntryKind[] = ['product', 'review', 'webinar']
export const WEBINAR_CATEGORIES: readonly WebinarCategory[] = ['products', 'doctors']
export const PRODUCT_CATEGORIES = ['supplements', 'devices', 'care', 'bath', 'drinks', 'home', 'accessories'] as const

export type EntryData = Record<string, string>

export interface CmsEntry {
  id: string
  kind: EntryKind
  status: EntryStatus
  data: EntryData
  createdAt: string
  updatedAt: string
  updatedByUserId: string | null
}

/** Обязательные поля. Документировано в docs/admin-add-drafts.md. */
export const REQUIRED_FIELDS: Record<EntryKind, readonly string[]> = {
  product: ['name', 'brandId', 'category', 'priceRub', 'imageUrl', 'description'],
  review: ['productId', 'author', 'text'],
  webinar: ['title', 'youtubeUrl', 'category'],
}
export const OPTIONAL_FIELDS: Record<EntryKind, readonly string[]> = {
  product: ['pack', 'pricePv'],
  review: [],
  webinar: ['speaker', 'date'],
}
const LIMITS: Record<string, number> = {
  name: 120, brandId: 20, category: 20, priceRub: 9, pricePv: 9, imageUrl: 500, description: 6000, pack: 60,
  productId: 60, author: 80, text: 2000, title: 200, youtubeUrl: 300, speaker: 120, date: 10,
}
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/
const DATE = /^\d{4}-\d{2}-\d{2}$/

export type FieldError = { field: string; error: string }

/** Проверка формата заполненных полей. Пустое поле — не ошибка (это черновик). */
function fieldError(kind: EntryKind, field: string, value: string): string | null {
  if (CONTROL.test(value) || Array.from(value).length > (LIMITS[field] ?? 200)) return 'invalid'
  switch (field) {
    case 'brandId':
      return Object.prototype.hasOwnProperty.call(BRAND_LABELS, value) ? null : 'invalid'
    case 'category':
      if (kind === 'webinar') return (WEBINAR_CATEGORIES as readonly string[]).includes(value) ? null : 'invalid'
      return (PRODUCT_CATEGORIES as readonly string[]).includes(value) ? null : 'invalid'
    case 'priceRub':
    case 'pricePv':
      return /^\d{1,9}$/.test(value) && Number(value) > 0 ? null : 'invalid'
    case 'imageUrl':
      return /^https:\/\/[^\s]+$/.test(value) || /^\/products\/[\w./-]+$/.test(value) ? null : 'invalid'
    case 'productId':
      return findProduct(value) ? null : 'unknown_product'
    case 'youtubeUrl': {
      const parsed = parseYoutubeUrl(value)
      return parsed && YOUTUBE_ID.test(parsed.videoId) ? null : 'invalid'
    }
    case 'date':
      return DATE.test(value) && !Number.isNaN(Date.parse(value)) ? null : 'invalid'
    default:
      return null
  }
}

/** Нормализует ввод: только известные поля, строки обрезаны, пустые — удалены. */
export function normalizeEntryData(kind: EntryKind, raw: unknown): { ok: true; data: EntryData } | { ok: false; error: FieldError } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: { field: 'data', error: 'bad_request' } }
  const allowed = [...REQUIRED_FIELDS[kind], ...OPTIONAL_FIELDS[kind]]
  const data: EntryData = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowed.includes(key)) continue
    if (value === null || value === undefined) continue
    if (typeof value !== 'string' && typeof value !== 'number') return { ok: false, error: { field: key, error: 'invalid' } }
    const text = String(value).trim()
    if (!text) continue
    const error = fieldError(kind, key, text)
    if (error) return { ok: false, error: { field: key, error } }
    data[key] = text
  }
  return { ok: true, data }
}

export function missingFields(kind: EntryKind, data: EntryData): string[] {
  return REQUIRED_FIELDS[kind].filter((f) => !data[f])
}

/** Черновик или публикация — решается только заполненностью обязательных полей. */
export function statusFor(kind: EntryKind, data: EntryData): EntryStatus {
  return missingFields(kind, data).length === 0 ? 'published' : 'draft'
}

export function isEntryKind(v: unknown): v is EntryKind {
  return typeof v === 'string' && (ENTRY_KINDS as readonly string[]).includes(v)
}

/* ---------- Публичные представления ---------- */

export function publicWebinarFromEntry(e: CmsEntry) {
  if (e.kind !== 'webinar' || e.status !== 'published') return null
  const parsed = parseYoutubeUrl(e.data.youtubeUrl ?? '')
  if (!parsed || !e.data.title) return null
  return {
    id: e.id,
    title: e.data.title,
    speaker: e.data.speaker ?? null,
    date: e.data.date ?? null,
    sourceType: 'youtube' as const,
    youtubeVideoId: parsed.videoId,
    startSeconds: parsed.startSeconds ?? null,
    recordingSrc: null,
    category: (e.data.category === 'doctors' ? 'doctors' : 'products') as WebinarCategory,
  }
}

export function publicReviewFromEntry(e: CmsEntry) {
  if (e.kind !== 'review' || e.status !== 'published' || !e.data.productId || !e.data.text) return null
  return { id: e.id, productId: e.data.productId, author: e.data.author ?? null, text: e.data.text, media: [] as never[] }
}

/** Новый товар целиком (публичные поля + идентичность), id/slug выводятся из id записи. */
export function publicProductFromEntry(e: CmsEntry) {
  if (e.kind !== 'product' || e.status !== 'published' || missingFields('product', e.data).length) return null
  const short = e.id.replace(/-/g, '').slice(0, 12)
  const rub = Number(e.data.priceRub)
  const pv = e.data.pricePv ? Number(e.data.pricePv) : 0
  return {
    id: `custom-${short}`,
    slug: `custom-${short}`,
    brandId: e.data.brandId!,
    category: e.data.category!,
    kind: e.data.category === 'devices' ? 'device' : e.data.category === 'supplements' ? 'supplement' : 'goods',
    form: null,
    priceListId: null,
    name: e.data.name!,
    pack: e.data.pack ?? null,
    price: { rub, pv },
    image: { src: e.data.imageUrl!, width: 600, height: 600 },
    gallery: [],
    description: {
      type: 'doc' as const,
      version: 1 as const,
      content: e.data.description!.split(/\n{2,}/).map((p) => ({ type: 'paragraph' as const, content: [{ type: 'text' as const, text: p.trim() }] })),
    },
  }
}

/* ---------- Хранилище ---------- */

export class EntriesMigrationPending extends Error {
  constructor() {
    super('migration_pending')
    this.name = 'EntriesMigrationPending'
  }
}

export interface EntryStore {
  list(kind: EntryKind | null, status: EntryStatus | null): Promise<CmsEntry[]>
  get(id: string): Promise<CmsEntry | null>
  save(entry: CmsEntry): Promise<void>
  /** Категории вебинаров из бота (webinars.category). Без миграции — пустая карта. */
  webinarCategories(ids: string[]): Promise<Map<string, WebinarCategory>>
  setWebinarCategory(id: string, category: WebinarCategory): Promise<'updated' | 'missing'>
}

function isMissingSchema(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return code === '42P01' || code === '42703'
}

interface EntryRow extends Record<string, unknown> {
  id: string
  kind: EntryKind
  status: EntryStatus
  data: EntryData
  created_at: string
  updated_at: string
  updated_by_user_id: string | null
}

function fromRow(r: EntryRow): CmsEntry {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    data: r.data && typeof r.data === 'object' ? r.data : {},
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    updatedByUserId: r.updated_by_user_id,
  }
}

const COLS = `id::text, kind, status, data, created_at::text, updated_at::text, updated_by_user_id::text`

export function createPgEntryStore(pool: SqlPool): EntryStore {
  async function run<T>(fn: (q: (text: string, values?: unknown[]) => Promise<{ rows: T[] }>) => Promise<unknown>) {
    const client = await pool.connect()
    try {
      return await fn((text, values) => client.query(text, values ?? []) as Promise<{ rows: T[] }>)
    } catch (error) {
      if (isMissingSchema(error)) throw new EntriesMigrationPending()
      throw error
    } finally {
      client.release()
    }
  }
  return {
    async list(kind, status) {
      return (await run<EntryRow>(async (q) => {
        const r = await q(
          `SELECT ${COLS} FROM cms_entries WHERE ($1::text IS NULL OR kind = $1) AND ($2::text IS NULL OR status = $2)
           ORDER BY updated_at DESC LIMIT 500`,
          [kind, status],
        )
        return r.rows.map(fromRow)
      })) as CmsEntry[]
    },
    async get(id) {
      return (await run<EntryRow>(async (q) => {
        const r = await q(`SELECT ${COLS} FROM cms_entries WHERE id = $1::uuid`, [id])
        return r.rows[0] ? fromRow(r.rows[0]) : null
      })) as CmsEntry | null
    },
    async save(e) {
      await run(async (q) =>
        q(
          `INSERT INTO cms_entries (id, kind, status, data, created_at, updated_at, updated_by_user_id)
           VALUES ($1::uuid, $2, $3, $4::jsonb, $5::timestamptz, $6::timestamptz, $7::bigint)
           ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, data = EXCLUDED.data,
             updated_at = EXCLUDED.updated_at, updated_by_user_id = EXCLUDED.updated_by_user_id`,
          [e.id, e.kind, e.status, JSON.stringify(e.data), e.createdAt, e.updatedAt, e.updatedByUserId],
        ),
      )
    },
    async webinarCategories(ids) {
      const map = new Map<string, WebinarCategory>()
      if (!ids.length) return map
      try {
        await run<{ id: string; category: string }>(async (q) => {
          const r = await q(`SELECT id::text, category FROM webinars WHERE id = ANY($1::uuid[])`, [ids])
          for (const row of r.rows) map.set(row.id, row.category === 'doctors' ? 'doctors' : 'products')
        })
      } catch (error) {
        if (!(error instanceof EntriesMigrationPending)) throw error
      }
      return map
    },
    async setWebinarCategory(id, category) {
      return (await run<{ id: string }>(async (q) => {
        const r = await q(`UPDATE webinars SET category = $2 WHERE id = $1::uuid RETURNING id::text`, [id, category])
        return r.rows.length ? 'updated' : 'missing'
      })) as 'updated' | 'missing'
    },
  }
}

/** Память — для тестов и локального dev-api. */
export function createMemoryEntryStore(opts: { migrated?: boolean; webinarIds?: string[] } = {}): EntryStore & { entries: Map<string, CmsEntry> } {
  const migrated = opts.migrated ?? true
  const entries = new Map<string, CmsEntry>()
  const categories = new Map<string, WebinarCategory>((opts.webinarIds ?? []).map((id) => [id, 'products']))
  const guard = () => {
    if (!migrated) throw new EntriesMigrationPending()
  }
  return {
    entries,
    async list(kind, status) {
      guard()
      return [...entries.values()]
        .filter((e) => (!kind || e.kind === kind) && (!status || e.status === status))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    },
    async get(id) {
      guard()
      return entries.get(id) ?? null
    },
    async save(e) {
      guard()
      entries.set(e.id, { ...e, data: { ...e.data } })
    },
    async webinarCategories(ids) {
      if (!migrated) return new Map()
      return new Map(ids.filter((id) => categories.has(id)).map((id) => [id, categories.get(id)!]))
    },
    async setWebinarCategory(id, category) {
      guard()
      if (!categories.has(id)) return 'missing'
      categories.set(id, category)
      return 'updated'
    },
  }
}
