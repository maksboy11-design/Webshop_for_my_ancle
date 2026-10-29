/**
 * Компактные WebP-миниатюры фото отзывов для списка Mini App модератора.
 * sharp подключается динамически: если нативный модуль недоступен, приём отзывов работает как раньше,
 * просто без миниатюры (список тогда показывает оригинал с ленивой загрузкой).
 */
export const THUMB_BOX = 160
export const THUMB_QUALITY = 60
/** Не декодируем огромные изображения: защита памяти функции. */
export const THUMB_MAX_INPUT_BYTES = 20 * 1024 * 1024
export const THUMB_MAX_INPUT_PIXELS = 40_000_000

type SharpFactory = (input: Buffer, options: { limitInputPixels: number; failOn: 'error' | 'none'; pages: number }) => {
  rotate: () => ReturnType<SharpFactory>
  resize: (options: { width: number; height: number; fit: 'inside'; withoutEnlargement: boolean }) => ReturnType<SharpFactory>
  webp: (options: { quality: number; effort: number }) => ReturnType<SharpFactory>
  toBuffer: () => Promise<Buffer>
}

let sharpPromise: Promise<SharpFactory | null> | null = null

async function loadSharp(): Promise<SharpFactory | null> {
  sharpPromise ??= import('sharp')
    .then((mod) => ((mod as { default?: unknown }).default ?? mod) as SharpFactory)
    .catch(() => null)
  return sharpPromise
}

/** Только растровые форматы, которые точно не видео. */
export function isThumbnailableImage(contentType: string | null, bytes: number): boolean {
  if (bytes <= 0 || bytes > THUMB_MAX_INPUT_BYTES) return false
  const lower = (contentType ?? '').toLowerCase()
  if (lower.startsWith('video/')) return false
  if (lower === '' || lower === 'application/octet-stream') return true
  return /^image\/(jpeg|jpg|pjpeg|png|webp|gif|heic|heif|avif)/.test(lower)
}

/** Пути миниатюры рядом с оригиналом: reviews/.../0.jpg -> reviews/.../0.thumb.webp (стабильно, без дублей). */
export function thumbnailPathFor(originalPathname: string): string {
  const clean = originalPathname.replace(/^\/+/, '')
  const slash = clean.lastIndexOf('/')
  const dot = clean.lastIndexOf('.')
  const base = dot > slash ? clean.slice(0, dot) : clean
  return `${base}.thumb.webp`
}

export async function makeThumbnail(bytes: Buffer, contentType: string | null): Promise<Buffer | null> {
  if (!isThumbnailableImage(contentType, bytes.length)) return null
  const sharp = await loadSharp()
  if (!sharp) return null
  try {
    return await sharp(bytes, { limitInputPixels: THUMB_MAX_INPUT_PIXELS, failOn: 'error', pages: 1 })
      .rotate()
      .resize({ width: THUMB_BOX, height: THUMB_BOX, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: THUMB_QUALITY, effort: 4 })
      .toBuffer()
  } catch {
    return null
  }
}
