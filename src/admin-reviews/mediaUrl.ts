/**
 * WebView MAX на телефоне не грузит медиа со сторонних доменов (Vercel Blob),
 * поэтому в Mini App отдаём их через same-origin rewrite /review-media/* (см. vercel.json).
 */
export const REVIEW_BLOB_HOST = 'nixktcrzq4krmovs.public.blob.vercel-storage.com'
export const REVIEW_MEDIA_PREFIX = '/review-media/'

export function toSameOriginMedia(src: string): string
export function toSameOriginMedia(src: string | null | undefined): string | undefined
export function toSameOriginMedia(src: string | null | undefined): string | undefined {
  if (!src) return undefined
  let url: URL
  try {
    url = new URL(src)
  } catch {
    return src
  }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== REVIEW_BLOB_HOST) return src
  if (!url.pathname.startsWith('/reviews/')) return src
  return `${REVIEW_MEDIA_PREFIX}${url.pathname.slice('/reviews/'.length)}${url.search}`
}
