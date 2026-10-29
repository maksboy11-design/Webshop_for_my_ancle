/**
 * Серверная валидация правок товаров. Любое значение из запроса проверяется здесь,
 * клиенту не доверяем. Тексты покупателя не переписываются (только проверка длины/формы).
 */
import { PRODUCTS, productById, type Product, type ProductImage } from '../../src/data/products'
import type { DescriptionParagraph, DescriptionSection } from '../../src/data/productDescriptions'
import {
  OVERRIDE_FIELDS,
  PRODUCT_BLOB_HOST,
  PRODUCT_BLOB_PREFIX,
  PRODUCT_MEDIA_PREFIX,
  mergeProduct,
  type OverrideField,
  type ProductOverride,
} from '../../src/cms/productMerge'

export const PRODUCT_NAME_MAX = 200
export const PRODUCT_PACK_MAX = 120
export const PRICE_MAX = 10_000_000
export const GALLERY_MAX = 12
export const SECTIONS_MAX = 80
export const PARAGRAPHS_MAX = 80
export const LIST_MAX = 120
export const TEXT_MAX = 6000
export const HEADING_MAX = 500
export const LABEL_MAX = 200

export type FieldResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** Статические изображения проекта (только они допустимы как локальные пути). */
const STATIC_IMAGES: ReadonlySet<string> = new Set(
  PRODUCTS.flatMap((p) => [p.image.src, ...p.gallery.map((g) => g.src)]),
)

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/

function cleanText(v: unknown, max: number, opts: { allowEmpty?: boolean; multiline?: boolean } = {}): FieldResult<string> {
  if (typeof v !== 'string') return { ok: false, error: 'not_string' }
  if (CONTROL.test(v)) return { ok: false, error: 'control_chars' }
  if (!opts.multiline && /[\r\n]/.test(v)) return { ok: false, error: 'multiline' }
  if (!opts.allowEmpty && v.trim() === '') return { ok: false, error: 'empty' }
  if (v.length > max) return { ok: false, error: 'too_long' }
  return { ok: true, value: v }
}

/** Нормализует адрес изображения: статический путь каталога или наш Blob (products/...). */
export function normalizeProductImageSrc(src: unknown): string | null {
  if (typeof src !== 'string' || src.length > 600) return null
  if (STATIC_IMAGES.has(src)) return src
  let path: string
  if (src.startsWith(PRODUCT_MEDIA_PREFIX)) {
    path = src.slice(PRODUCT_MEDIA_PREFIX.length)
  } else {
    let url: URL
    try {
      url = new URL(src)
    } catch {
      return null
    }
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== PRODUCT_BLOB_HOST) return null
    if (url.search || url.hash || !url.pathname.startsWith(PRODUCT_BLOB_PREFIX)) return null
    path = url.pathname.slice(PRODUCT_BLOB_PREFIX.length)
  }
  if (!/^[a-z0-9-]{1,60}\/[a-zA-Z0-9-]{8,80}(\.thumb)?\.webp$/.test(path)) return null
  return `https://${PRODUCT_BLOB_HOST}${PRODUCT_BLOB_PREFIX}${path}`
}

function dim(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 10000 ? v : null
}

export function validateImage(v: unknown): FieldResult<ProductImage> {
  if (!v || typeof v !== 'object') return { ok: false, error: 'image_invalid' }
  const o = v as Record<string, unknown>
  const src = normalizeProductImageSrc(o.src)
  if (!src) return { ok: false, error: 'image_src_not_allowed' }
  const width = dim(o.width)
  const height = dim(o.height)
  if (!width || !height) return { ok: false, error: 'image_size_invalid' }
  const out: ProductImage = { src, width, height }
  if (o.thumb !== undefined && o.thumb !== null) {
    const thumb = normalizeProductImageSrc(o.thumb)
    if (!thumb) return { ok: false, error: 'image_src_not_allowed' }
    out.thumb = thumb
  }
  return { ok: true, value: out }
}

function money(v: unknown, decimals: boolean): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > PRICE_MAX) return null
  if (!decimals && !Number.isInteger(v)) return null
  if (decimals && Math.round(v * 100) !== v * 100) return null
  return v
}

function validateParagraph(v: unknown): FieldResult<DescriptionParagraph> {
  if (typeof v === 'string') return cleanText(v, TEXT_MAX, { multiline: true })
  if (!v || typeof v !== 'object') return { ok: false, error: 'paragraph_invalid' }
  const o = v as Record<string, unknown>
  const label = cleanText(o.label, LABEL_MAX)
  if (!label.ok) return { ok: false, error: `label_${label.error}` }
  const text = cleanText(o.text, TEXT_MAX, { multiline: true })
  if (!text.ok) return { ok: false, error: `text_${text.error}` }
  return { ok: true, value: { label: label.value, text: text.value } }
}

export function validateSection(v: unknown): FieldResult<DescriptionSection> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: 'section_invalid' }
  const o = v as Record<string, unknown>
  const out: { -readonly [K in keyof DescriptionSection]: DescriptionSection[K] } = {}
  if (o.level !== undefined && o.level !== null) {
    if (o.level !== 'group' && o.level !== 'major' && o.level !== 'minor') return { ok: false, error: 'level_invalid' }
    out.level = o.level
  }
  if (o.number !== undefined && o.number !== null && o.number !== '') {
    const n = cleanText(o.number, 12)
    if (!n.ok) return { ok: false, error: `number_${n.error}` }
    out.number = n.value
  }
  if (o.heading !== undefined && o.heading !== null && o.heading !== '') {
    const h = cleanText(o.heading, HEADING_MAX, { multiline: true })
    if (!h.ok) return { ok: false, error: `heading_${h.error}` }
    out.heading = h.value
  }
  if (o.paragraphs !== undefined && o.paragraphs !== null) {
    if (!Array.isArray(o.paragraphs) || o.paragraphs.length > PARAGRAPHS_MAX) return { ok: false, error: 'paragraphs_invalid' }
    const list: DescriptionParagraph[] = []
    for (const p of o.paragraphs) {
      const r = validateParagraph(p)
      if (!r.ok) return r
      list.push(r.value)
    }
    if (list.length) out.paragraphs = list
  }
  if (o.list !== undefined && o.list !== null) {
    if (!Array.isArray(o.list) || o.list.length > LIST_MAX) return { ok: false, error: 'list_invalid' }
    const items: string[] = []
    for (const item of o.list) {
      const r = cleanText(item, TEXT_MAX, { multiline: true })
      if (!r.ok) return { ok: false, error: `list_${r.error}` }
      items.push(r.value)
    }
    if (items.length) out.list = items
  }
  if (o.listStyle !== undefined && o.listStyle !== null) {
    if (o.listStyle !== 'bullet' && o.listStyle !== 'none') return { ok: false, error: 'list_style_invalid' }
    out.listStyle = o.listStyle
  }
  if (!out.heading && !out.paragraphs && !out.list) return { ok: false, error: 'section_empty' }
  return { ok: true, value: out }
}

export interface PatchResult {
  ok: boolean
  error?: string
  field?: string
  override?: ProductOverride
}

/**
 * Применяет PATCH к текущему переопределению. Тело: { set?: {...поля}, reset?: ['name', ...] }.
 * reset — вернуть поле к статическому каталогу; null в set — явная очистка (только для pack/price/description).
 */
export function applyProductPatch(current: ProductOverride, body: unknown): PatchResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'invalid_body' }
  const b = body as Record<string, unknown>
  const next: Record<string, unknown> = { ...current }
  if (b.reset !== undefined) {
    if (!Array.isArray(b.reset)) return { ok: false, error: 'invalid_reset' }
    for (const f of b.reset) {
      if (!OVERRIDE_FIELDS.includes(f as OverrideField)) return { ok: false, error: 'invalid_reset', field: String(f) }
      delete next[f as string]
    }
  }
  const set = b.set
  if (set !== undefined) {
    if (!set || typeof set !== 'object' || Array.isArray(set)) return { ok: false, error: 'invalid_body' }
    const s = set as Record<string, unknown>
    for (const key of Object.keys(s)) {
      if (!OVERRIDE_FIELDS.includes(key as OverrideField)) return { ok: false, error: 'unknown_field', field: key }
    }
    if ('name' in s) {
      const r = cleanText(s.name, PRODUCT_NAME_MAX)
      if (!r.ok) return { ok: false, error: `name_${r.error}`, field: 'name' }
      next.name = r.value
    }
    if ('pack' in s) {
      if (s.pack === null) next.pack = null
      else {
        const r = cleanText(s.pack, PRODUCT_PACK_MAX)
        if (!r.ok) return { ok: false, error: `pack_${r.error}`, field: 'pack' }
        next.pack = r.value
      }
    }
    if ('price' in s) {
      if (s.price === null) next.price = null
      else {
        const p = s.price as Record<string, unknown> | undefined
        const rub = p && typeof p === 'object' ? money(p.rub, false) : null
        const pv = p && typeof p === 'object' ? money(p.pv, true) : null
        if (rub === null || pv === null) return { ok: false, error: 'price_invalid', field: 'price' }
        next.price = { rub, pv }
      }
    }
    if ('image' in s) {
      const r = validateImage(s.image)
      if (!r.ok) return { ok: false, error: r.error, field: 'image' }
      next.image = r.value
    }
    if ('gallery' in s) {
      if (!Array.isArray(s.gallery) || s.gallery.length > GALLERY_MAX) return { ok: false, error: 'gallery_invalid', field: 'gallery' }
      const g: ProductImage[] = []
      for (const item of s.gallery) {
        const r = validateImage(item)
        if (!r.ok) return { ok: false, error: r.error, field: 'gallery' }
        g.push(r.value)
      }
      next.gallery = g
    }
    if ('description' in s) {
      if (s.description === null) next.description = null
      else {
        if (!Array.isArray(s.description) || s.description.length > SECTIONS_MAX)
          return { ok: false, error: 'description_invalid', field: 'description' }
        const sections: DescriptionSection[] = []
        for (const sec of s.description) {
          const r = validateSection(sec)
          if (!r.ok) return { ok: false, error: r.error, field: 'description' }
          sections.push(r.value)
        }
        next.description = sections.length ? sections : null
      }
    }
  }
  return { ok: true, override: next as ProductOverride }
}

/** Защита от мусора в БД: перепроверяет сохранённый JSON. Невалидные поля отбрасываются. */
export function sanitizeStoredOverride(raw: unknown): ProductOverride {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, unknown> = {}
  for (const key of OVERRIDE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue
    const r = applyProductPatch({}, { set: { [key]: (raw as Record<string, unknown>)[key] } })
    if (r.ok && r.override && Object.prototype.hasOwnProperty.call(r.override, key)) {
      out[key] = (r.override as Record<string, unknown>)[key]
    }
  }
  return out as ProductOverride
}

export function isKnownProductId(id: string): boolean {
  return /^[a-z0-9-]{1,60}$/.test(id) && !!productById(id)
}

export function mergedCatalog(overrides: ReadonlyMap<string, ProductOverride>): Product[] {
  return PRODUCTS.map((p) => mergeProduct(p, overrides.get(p.id)))
}
