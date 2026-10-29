/**
 * Слой данных товаров: статический каталог проекта — база, сохранённые в PostgreSQL правки — переопределения.
 * Используется и сервером (GET /api/products), и сайтом (наложение ответа API на статический каталог).
 * Отсутствующий ключ = «не переопределено»; явный null = намеренно очищено (цена уточняется / нет описания / нет фасовки).
 */
import type { ProductPrice } from '../data/price'
import type { ProductDescription } from '../data/productDescriptions'
import type { Product, ProductImage } from '../data/products'

export const PRODUCT_BLOB_HOST = 'nixktcrzq4krmovs.public.blob.vercel-storage.com'
export const PRODUCT_BLOB_PREFIX = '/products/'
export const PRODUCT_MEDIA_PREFIX = '/product-media/'

export interface ProductOverride {
  name?: string
  pack?: string | null
  price?: ProductPrice | null
  image?: ProductImage
  gallery?: ProductImage[]
  description?: ProductDescription | null
}

export const OVERRIDE_FIELDS = ['name', 'pack', 'price', 'image', 'gallery', 'description'] as const
export type OverrideField = (typeof OVERRIDE_FIELDS)[number]

/** Публичные (редактируемые) поля товара, которые отдаёт /api/products. */
export interface PublicProductData {
  id: string
  name: string
  pack: string | null
  price: ProductPrice | null
  image: ProductImage
  gallery: ProductImage[]
  description: ProductDescription | null
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
  }
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
  return out
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
  }
}
