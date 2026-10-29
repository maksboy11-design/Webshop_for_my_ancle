/**
 * Загрузка изображения товара: проверка сигнатуры (не доверяем Content-Type), лимиты размера и пикселей,
 * перекодирование через sharp в WebP (основное + миниатюра), запись в Vercel Blob под products/<id>/.
 * В БД — только https-адрес нашего Blob, никаких base64 и внешних URL.
 */
import { randomUUID } from 'node:crypto'
import { PRODUCT_BLOB_HOST } from '../../src/cms/productMerge'
import type { ProductImage } from '../../src/data/products'

export const UPLOAD_MAX_BYTES = 4 * 1024 * 1024
export const UPLOAD_MAX_PIXELS = 40_000_000
export const MAIN_BOX = 1600
export const THUMB_BOX = 480

export type ImageKind = 'jpeg' | 'png' | 'webp'

/** Сигнатура файла: JPEG FF D8 FF, PNG 89 50 4E 47 0D 0A 1A 0A, WebP RIFF....WEBP. */
export function sniffImage(bytes: Uint8Array): ImageKind | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length >= 8 && png.every((b, i) => bytes[i] === b)) return 'png'
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  )
    return 'webp'
  return null
}

export interface EncodedImage {
  data: Buffer
  width: number
  height: number
}

export interface ImageEncoder {
  encode(input: Buffer, box: number, quality: number): Promise<EncodedImage>
}

export type BlobPutter = (path: string, data: Buffer, contentType: string) => Promise<string>

interface SharpChain {
  rotate: () => SharpChain
  resize: (o: { width: number; height: number; fit: 'inside'; withoutEnlargement: boolean }) => SharpChain
  webp: (o: { quality: number; effort: number }) => SharpChain
  toBuffer: (o: { resolveWithObject: true }) => Promise<{ data: Buffer; info: { width: number; height: number } }>
}
type SharpFactory = (input: Buffer, o: { limitInputPixels: number; failOn: 'error'; pages: number }) => SharpChain

let sharpPromise: Promise<SharpFactory | null> | null = null

export function sharpEncoder(): ImageEncoder {
  return {
    async encode(input, box, quality) {
      sharpPromise ??= import('sharp')
        .then((m) => ((m as { default?: unknown }).default ?? m) as SharpFactory)
        .catch(() => null)
      const sharp = await sharpPromise
      if (!sharp) throw new Error('sharp_unavailable')
      const out = await sharp(input, { limitInputPixels: UPLOAD_MAX_PIXELS, failOn: 'error', pages: 1 })
        .rotate()
        .resize({ width: box, height: box, fit: 'inside', withoutEnlargement: true })
        .webp({ quality, effort: 4 })
        .toBuffer({ resolveWithObject: true })
      return { data: out.data, width: out.info.width, height: out.info.height }
    },
  }
}

export function vercelBlobPutter(token: string): BlobPutter {
  return async (path, data, contentType) => {
    const { put } = await import('@vercel/blob')
    const result = await put(path, data, {
      access: 'public',
      token,
      contentType,
      addRandomSuffix: false,
      allowOverwrite: false,
      cacheControlMaxAge: 31_536_000,
    })
    const url = new URL(result.url)
    if (url.hostname !== PRODUCT_BLOB_HOST) throw new Error('unexpected_blob_host')
    return result.url
  }
}

export type UploadResult =
  | { ok: true; image: ProductImage }
  | { ok: false; status: number; error: string }

export async function processProductImage(
  productId: string,
  bytes: Buffer,
  encoder: ImageEncoder,
  putBlob: BlobPutter,
): Promise<UploadResult> {
  if (bytes.length === 0) return { ok: false, status: 400, error: 'empty_file' }
  if (bytes.length > UPLOAD_MAX_BYTES) return { ok: false, status: 413, error: 'file_too_large' }
  if (!sniffImage(bytes)) return { ok: false, status: 415, error: 'unsupported_image_type' }
  let main: EncodedImage
  let thumb: EncodedImage
  try {
    main = await encoder.encode(bytes, MAIN_BOX, 82)
    thumb = await encoder.encode(bytes, THUMB_BOX, 72)
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (/pixel limit|exceeds/i.test(msg)) return { ok: false, status: 413, error: 'image_too_many_pixels' }
    if (msg === 'sharp_unavailable') return { ok: false, status: 503, error: 'image_processing_unavailable' }
    return { ok: false, status: 422, error: 'image_decode_failed' }
  }
  const key = randomUUID().replace(/-/g, '')
  const base = `products/${productId}/${key}`
  const src = await putBlob(`${base}.webp`, main.data, 'image/webp')
  const thumbSrc = await putBlob(`${base}.thumb.webp`, thumb.data, 'image/webp')
  return { ok: true, image: { src, width: main.width, height: main.height, thumb: thumbSrc } }
}
