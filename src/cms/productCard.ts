/**
 * Поля карточки товара в product_content.draft/published.meta.
 * Черновик не попадает на сайт до явной публикации (как описание).
 */
import type { ProductPrice } from '../data/price'
import type { Category, ProductImage, ProductKind } from '../data/products'
import { BRAND_LABELS } from '../content/copy'
import type { ContentMeta } from './blocks'

export const PRODUCT_STATUSES = ['draft', 'review', 'published', 'archived'] as const
export type ProductStatus = (typeof PRODUCT_STATUSES)[number]
export const isProductStatus = (v: unknown): v is ProductStatus =>
  typeof v === 'string' && (PRODUCT_STATUSES as readonly string[]).includes(v)

export const CATEGORIES = ['supplements', 'devices', 'care', 'bath', 'drinks', 'home', 'accessories'] as const
export const isCategory = (v: unknown): v is Category => typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v)
export const isBrandId = (v: unknown): v is keyof typeof BRAND_LABELS =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(BRAND_LABELS, v)

export const TAG_MAX = 40
export const TAGS_MAX = 30
export const BADGE_MAX = 40
export const BADGES_MAX = 12

export interface CardFields {
  name?: string
  pack?: string | null
  price?: ProductPrice | null
  category?: Category
  brandId?: keyof typeof BRAND_LABELS
  kind?: ProductKind
  tags?: string[]
  badges?: string[]
  image?: ProductImage
  gallery?: ProductImage[]
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function cleanTag(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim().slice(0, max)
  return t ? t : null
}

function cleanTags(v: unknown, maxItems: number, maxLen: number): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of v) {
    const t = cleanTag(raw, maxLen)
    if (!t || seen.has(t.toLowerCase())) continue
    seen.add(t.toLowerCase())
    out.push(t)
    if (out.length >= maxItems) break
  }
  return out
}

function cleanPrice(v: unknown): ProductPrice | null | undefined {
  if (v === null) return null
  if (!isObj(v)) return undefined
  const rub = v.rub
  const pv = v.pv
  if (typeof rub !== 'number' || typeof pv !== 'number' || !Number.isFinite(rub) || !Number.isFinite(pv)) return undefined
  if (rub < 0 || rub > 10_000_000 || pv < 0 || pv > 10_000_000) return undefined
  return { rub: Math.round(rub), pv: Math.round(pv * 100) / 100 }
}

function cleanImage(v: unknown): ProductImage | undefined {
  if (!isObj(v) || typeof v.src !== 'string' || !v.src) return undefined
  const width = typeof v.width === 'number' && v.width > 0 ? Math.round(v.width) : 0
  const height = typeof v.height === 'number' && v.height > 0 ? Math.round(v.height) : 0
  if (!width || !height) return undefined
  const out: ProductImage = { src: v.src.slice(0, 500), width, height }
  if (typeof v.thumb === 'string' && v.thumb) out.thumb = v.thumb.slice(0, 500)
  if (typeof v.srcSet === 'string' && v.srcSet) out.srcSet = v.srcSet.slice(0, 2000)
  return out
}

/** Читает поля карточки из meta (мягко: битое пропускается). */
export function readCardFields(meta: ContentMeta | null | undefined): CardFields {
  if (!meta || !isObj(meta)) return {}
  const out: CardFields = {}
  if (typeof meta.name === 'string' && meta.name.trim()) out.name = meta.name.trim().slice(0, 200)
  if (meta.pack === null) out.pack = null
  else if (typeof meta.pack === 'string') out.pack = meta.pack.slice(0, 120)
  const price = cleanPrice(meta.price)
  if (price !== undefined) out.price = price
  if (isCategory(meta.category)) out.category = meta.category
  if (isBrandId(meta.brandId)) out.brandId = meta.brandId
  if (meta.kind === 'device' || meta.kind === 'supplement' || meta.kind === 'goods') out.kind = meta.kind
  const tags = cleanTags(meta.tags, TAGS_MAX, TAG_MAX)
  if (tags) out.tags = tags
  const badges = cleanTags(meta.badges, BADGES_MAX, BADGE_MAX)
  if (badges) out.badges = badges
  const image = cleanImage(meta.image)
  if (image) out.image = image
  if (Array.isArray(meta.gallery)) {
    out.gallery = meta.gallery
      .map(cleanImage)
      .filter((x): x is ProductImage => !!x)
      .slice(0, 12)
  }
  return out
}

/** Накладывает патч карточки на meta; неизвестные ключи meta сохраняет. */
export function applyCardPatch(meta: ContentMeta, patch: CardFields): ContentMeta {
  const next: ContentMeta = { ...meta }
  if (patch.name !== undefined) next.name = patch.name
  if (patch.pack !== undefined) next.pack = patch.pack
  if (patch.price !== undefined) next.price = patch.price
  if (patch.category !== undefined) next.category = patch.category
  if (patch.brandId !== undefined) next.brandId = patch.brandId
  if (patch.kind !== undefined) next.kind = patch.kind
  if (patch.tags !== undefined) next.tags = patch.tags
  if (patch.badges !== undefined) next.badges = patch.badges
  if (patch.image !== undefined) next.image = patch.image
  if (patch.gallery !== undefined) next.gallery = patch.gallery
  return next
}

/** Поля карточки из published.meta → патч для cms_product_overrides (публичный каталог). */
export function cardToOverridePatch(card: CardFields): {
  name?: string
  pack?: string | null
  price?: ProductPrice | null
  image?: ProductImage
  gallery?: ProductImage[]
  category?: Category
  brandId?: keyof typeof BRAND_LABELS
  tags?: string[]
  badges?: string[]
} {
  const o: ReturnType<typeof cardToOverridePatch> = {}
  if (card.name !== undefined) o.name = card.name
  if (card.pack !== undefined) o.pack = card.pack
  if (card.price !== undefined) o.price = card.price
  if (card.image !== undefined) o.image = card.image
  if (card.gallery !== undefined) o.gallery = card.gallery
  if (card.category !== undefined) o.category = card.category
  if (card.brandId !== undefined) o.brandId = card.brandId
  if (card.tags !== undefined) o.tags = card.tags
  if (card.badges !== undefined) o.badges = card.badges
  return o
}

export const BULK_OPS = [
  'set_status',
  'set_category',
  'set_brand',
  'add_tags',
  'remove_tags',
  'set_badges',
  'archive',
  'trash',
  'restore',
  'publish',
  'unpublish',
] as const
export type BulkOp = (typeof BULK_OPS)[number]
export const isBulkOp = (v: unknown): v is BulkOp => typeof v === 'string' && (BULK_OPS as readonly string[]).includes(v)

export const BULK_MAX_IDS = 50

export interface DuplicateParts {
  card: boolean
  content: boolean
  media: boolean
  documents: boolean
}

export const defaultDuplicateParts = (): DuplicateParts => ({ card: true, content: true, media: true, documents: true })

export function readDuplicateParts(raw: unknown): DuplicateParts {
  const d = defaultDuplicateParts()
  if (!isObj(raw)) return d
  for (const k of ['card', 'content', 'media', 'documents'] as const) {
    if (typeof raw[k] === 'boolean') d[k] = raw[k]
  }
  return d
}

/** Новый id для дубликата: не совпадает с исходным, укладывается в CHECK. */
export function duplicateProductId(sourceId: string, rand = Math.random): string {
  const suffix = Math.floor(rand() * 36 ** 4)
    .toString(36)
    .padStart(4, '0')
  const base = `copy-${sourceId}`.slice(0, 55)
  return `${base}-${suffix}`.slice(0, 60)
}
