/**
 * Слой данных товаров: статический каталог проекта — база, сохранённые в PostgreSQL правки — переопределения.
 * Используется и сервером (GET /api/products), и сайтом (наложение ответа API на статический каталог).
 * Отсутствующий ключ = «не переопределено»; явный null = намеренно очищено (цена уточняется / нет описания / нет фасовки).
 */
import type { ProductPrice } from '../data/price'
import type { AnyDescription } from './descriptionDoc'
import { sanitizePublicExtras } from './richBlocks'
import type { Category, Product, ProductDocument, ProductExtras, ProductImage } from '../data/products'
import { BRAND_LABELS } from '../content/copy'

export const PRODUCT_BLOB_HOST = 'nixktcrzq4krmovs.public.blob.vercel-storage.com'
export const PRODUCT_BLOB_PREFIX = '/products/'
export const PRODUCT_MEDIA_PREFIX = '/product-media/'

export interface ProductOverride {
  name?: string
  pack?: string | null
  price?: ProductPrice | null
  image?: ProductImage
  gallery?: ProductImage[]
  description?: AnyDescription | null
  category?: Category
  brandId?: keyof typeof BRAND_LABELS
  tags?: string[]
  badges?: string[]
}

export const OVERRIDE_FIELDS = [
  'name',
  'pack',
  'price',
  'image',
  'gallery',
  'description',
  'category',
  'brandId',
  'tags',
  'badges',
] as const
export type OverrideField = (typeof OVERRIDE_FIELDS)[number]

/** Публичные (редактируемые) поля товара, которые отдаёт /api/products. */
export interface PublicProductData {
  id: string
  name: string
  pack: string | null
  price: ProductPrice | null
  image: ProductImage
  gallery: ProductImage[]
  description: AnyDescription | null
  category?: Category
  brandId?: keyof typeof BRAND_LABELS
  tags?: string[]
  badges?: string[]
  documents?: ProductDocument[]
  extras?: ProductExtras
}

function has<K extends OverrideField>(o: ProductOverride, key: K): boolean {
  return Object.prototype.hasOwnProperty.call(o, key)
}

export function mergeProduct(base: Product, override: ProductOverride | null | undefined): Product {
  if (!override) return base
  return {
    ...base,
    name: has(override, 'name') && override.name ? override.name : base.name,
    pack: has(override, 'pack') ? (override.pack ?? null) : base.pack,
    price: has(override, 'price') ? (override.price ?? null) : base.price,
    image: has(override, 'image') && override.image ? override.image : base.image,
    gallery: has(override, 'gallery') && override.gallery ? override.gallery : base.gallery,
    description: has(override, 'description') ? (override.description ?? null) : base.description,
    category: has(override, 'category') && override.category ? override.category : base.category,
    brandId: has(override, 'brandId') && override.brandId ? override.brandId : base.brandId,
    ...(has(override, 'tags') ? { tags: override.tags ?? [] } : {}),
    ...(has(override, 'badges') ? { badges: override.badges ?? [] } : {}),
  } as Product
}

/** Blob-адрес загруженного изображения товара -> same-origin /product-media/... (WebView MAX и сайт). */
export function toSameOriginProductMedia(src: string): string {
  let url: URL
  try {
    url = new URL(src)
  } catch {
    return src
  }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== PRODUCT_BLOB_HOST) return src
  if (!url.pathname.startsWith(PRODUCT_BLOB_PREFIX)) return src
  return `${PRODUCT_MEDIA_PREFIX}${url.pathname.slice(PRODUCT_BLOB_PREFIX.length)}`
}

function publicImage(image: ProductImage): ProductImage {
  const out: ProductImage = { src: toSameOriginProductMedia(image.src), width: image.width, height: image.height }
  if (image.thumb) out.thumb = toSameOriginProductMedia(image.thumb)
  if (image.srcSet) {
    out.srcSet = image.srcSet
      .split(',')
      .map((part) => {
        const [u, w] = part.trim().split(/\s+/)
        return u ? `${toSameOriginProductMedia(u)}${w ? ` ${w}` : ''}` : ''
      })
      .filter(Boolean)
      .join(', ')
  }
  return out
}

function sameOriginSet(set: string | undefined): string | undefined {
  return set
    ?.split(',')
    .map((part) => {
      const [u, w] = part.trim().split(/\s+/)
      return u ? `${toSameOriginProductMedia(u)}${w ? ` ${w}` : ''}` : ''
    })
    .filter(Boolean)
    .join(', ')
}

function sameOriginBlockImage<T extends { src: string; srcSet?: string }>(img: T): T {
  return { ...img, src: toSameOriginProductMedia(img.src), ...(img.srcSet ? { srcSet: sameOriginSet(img.srcSet) } : {}) }
}

function sameOriginExtras(x: ProductExtras): ProductExtras {
  return {
    blocks: x.blocks.map((b) =>
      b.type === 'image'
        ? { ...b, image: b.image ? sameOriginBlockImage(b.image) : null }
        : b.type === 'gallery'
          ? { ...b, items: b.items.map(sameOriginBlockImage) }
          : b,
    ),
    videos: x.videos.map((v) => ({
      ...v,
      src: v.provider === 'upload' ? toSameOriginProductMedia(v.src) : v.src,
      poster: v.poster ? { ...v.poster, src: toSameOriginProductMedia(v.poster.src) } : null,
    })),
    ...(x.tabs?.length ? { tabs: x.tabs } : {}),
  }
}

export function toPublicProductData(product: Product): PublicProductData {
  return {
    id: product.id,
    name: product.name,
    pack: product.pack,
    price: product.price ? { rub: product.price.rub, pv: product.price.pv } : null,
    image: publicImage(product.image),
    gallery: product.gallery.map(publicImage),
    description: product.description,
    category: product.category,
    brandId: product.brandId,
    ...(product.tags?.length ? { tags: product.tags } : {}),
    ...(product.badges?.length ? { badges: product.badges } : {}),
    ...(product.documents?.length ? { documents: product.documents.map((d) => ({ ...d, url: toSameOriginProductMedia(d.url) })) } : {}),
    ...(product.extras && (product.extras.blocks.length || product.extras.videos.length || product.extras.tabs?.length)
      ? { extras: sameOriginExtras(product.extras) }
      : {}),
  }
}

/** Накладывает публичные данные из API на статический товар. Идентичность (id, slug, категория, бренд) не меняется. */
export function applyPublicData(base: Product, data: PublicProductData | undefined): Product {
  if (!data || data.id !== base.id) return base
  return {
    ...base,
    name: typeof data.name === 'string' && data.name ? data.name : base.name,
    pack: data.pack ?? null,
    price: data.price ?? null,
    image: data.image?.src ? data.image : base.image,
    gallery: Array.isArray(data.gallery) ? data.gallery : base.gallery,
    description: data.description ?? null,
    category: data.category && typeof data.category === 'string' ? data.category : base.category,
    brandId: data.brandId && typeof data.brandId === 'string' && data.brandId in BRAND_LABELS ? data.brandId : base.brandId,
    tags: Array.isArray(data.tags) ? data.tags.filter((t): t is string => typeof t === 'string').slice(0, 30) : base.tags,
    badges: Array.isArray(data.badges) ? data.badges.filter((t): t is string => typeof t === 'string').slice(0, 12) : base.badges,
    documents: Array.isArray(data.documents)
      ? data.documents.filter(
          (d) => d && typeof d.title === 'string' && typeof d.url === 'string' && (d.url.startsWith('/') || d.url.startsWith('https://')),
        )
      : undefined,
    extras: sanitizePublicExtras(data.extras),
  }
}
