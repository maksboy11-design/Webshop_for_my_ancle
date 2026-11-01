/** Медиатека → поля image/gallery товара для публичного API (лёгкий модуль без Blob/sharp). */
import type { ProductDocument, ProductImage } from '../../src/data/products'
import type { MediaRecord, ProductMediaLink } from './mediaStore'

/** Изображение медиатеки → поле товара для сайта: srcset из вариантов, src — large (или оригинал). Адреса — Blob (сайт сам переводит в same-origin). */
export function mediaToProductImage(m: MediaRecord): ProductImage | null {
  if (m.kind !== 'image' || m.status !== 'ready' || m.deletedAt) return null
  const v = m.variants
  const best = v.large ?? v.medium
  const out: ProductImage = { src: best?.url ?? m.blobUrl, width: best?.width ?? m.width ?? 1, height: best?.height ?? m.height ?? 1 }
  if (v.thumb) out.thumb = v.thumb.url
  const set = (['thumb', 'medium', 'large'] as const).filter((n) => v[n]).map((n) => `${v[n]!.url} ${v[n]!.width}w`)
  if (set.length > 1) out.srcSet = set.join(', ')
  return out
}

/** Главное фото и галерея товара из product_media (только готовые изображения). */
export function productImagesFromLinks(links: ProductMediaLink[]): { image?: ProductImage; gallery?: ProductImage[] } {
  const main = links.find((l) => l.role === 'main')
  const gallery = links
    .filter((l) => l.role === 'gallery')
    .map((l) => mediaToProductImage(l.media))
    .filter((x): x is ProductImage => !!x)
  const out: { image?: ProductImage; gallery?: ProductImage[] } = {}
  const img = main ? mediaToProductImage(main.media) : null
  if (img) out.image = img
  if (gallery.length) out.gallery = gallery
  return out
}

/** Документы товара: подпись — title из медиатеки или исходное имя файла. */
export function productDocumentsFromLinks(links: ProductMediaLink[]): ProductDocument[] {
  return links
    .filter((l) => l.role === 'document' && l.media && !l.media.deletedAt && l.media.status === 'ready')
    .map((l) => ({
      title: l.media.title?.trim() || l.media.originalName,
      url: l.media.blobUrl,
      size: l.media.sizeBytes,
      mime: l.media.mime,
    }))
}
