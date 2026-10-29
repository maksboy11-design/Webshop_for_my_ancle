import { put } from '@vercel/blob'
import https from 'node:https'
import { getCACertificates } from 'node:tls'
import {
  attachmentsForStorage,
  attachmentsNeedPersist,
  MAX_MEDIA_BYTES,
  mergeSourceUrls,
  readAttachments,
  type StoredAttachment,
} from './attachments'
import { isAllowedMaxMediaUrl } from './mediaHosts'
import type { Log } from './logger'
import type { MaxClient } from './maxClient'
import { russianTrustedRootCa } from './rootCa'
import { makeThumbnail, thumbnailPathFor } from './thumbnail'
import type { ReviewStore } from './store'

const trustedCas = [...getCACertificates(), russianTrustedRootCa]

export interface MediaPersistDeps {
  blobToken: string | null
  max: MaxClient | null
  store: ReviewStore
  log: Log
  fetchBinary?: (url: string, limitBytes: number) => Promise<{ bytes: Buffer; contentType: string | null } | null>
  /** Для тестов: подмена генератора миниатюр. По умолчанию sharp (если доступен). */
  makeThumbnail?: (bytes: Buffer, contentType: string | null) => Promise<Buffer | null>
}

/** Миниатюры неизменяемы (стабильный путь от оригинала): кешируем на год. */
const THUMB_CACHE_SECONDS = 31_536_000

async function persistThumbnail(
  bytes: Buffer,
  contentType: string | null,
  originalPathname: string,
  deps: MediaPersistDeps,
): Promise<string | null> {
  if (!deps.blobToken) return null
  try {
    const thumb = await (deps.makeThumbnail ?? makeThumbnail)(bytes, contentType)
    if (!thumb) return null
    const blob = await put(thumbnailPathFor(originalPathname), thumb, {
      access: 'public',
      token: deps.blobToken,
      contentType: 'image/webp',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: THUMB_CACHE_SECONDS,
    })
    return blob.url
  } catch {
    deps.log.info('media_thumbnail_failed')
    return null
  }
}

function extensionFor(type: 'image' | 'video', contentType: string | null): string {
  const lower = (contentType ?? '').toLowerCase()
  if (type === 'image') {
    if (lower.includes('png')) return 'png'
    if (lower.includes('webp')) return 'webp'
    if (lower.includes('gif')) return 'gif'
    return 'jpg'
  }
  if (lower.includes('webm')) return 'webm'
  if (lower.includes('quicktime') || lower.includes('mov')) return 'mov'
  return 'mp4'
}

async function defaultFetchBinary(url: string, limitBytes: number): Promise<{ bytes: Buffer; contentType: string | null } | null> {
  if (!isAllowedMaxMediaUrl(url)) return null
  const target = new URL(url)
  return new Promise((resolve) => {
    const request = https.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method: 'GET',
        headers: { accept: '*/*' },
        ca: trustedCas,
        timeout: 8_000,
      },
      (response) => {
        const status = response.statusCode ?? 500
        if (status >= 300 && status < 400) {
          const location = response.headers.location
          response.resume()
          if (typeof location !== 'string') {
            resolve(null)
            return
          }
          const absolute = new URL(location, target).toString()
          if (!isAllowedMaxMediaUrl(absolute)) {
            resolve(null)
            return
          }
          void defaultFetchBinary(absolute, limitBytes).then(resolve)
          return
        }
        if (status < 200 || status >= 300) {
          response.resume()
          resolve(null)
          return
        }
        const contentType = typeof response.headers['content-type'] === 'string' ? response.headers['content-type'] : null
        const chunks: Buffer[] = []
        let total = 0
        let failed = false
        response.on('data', (chunk: Buffer) => {
          total += chunk.length
          if (total > limitBytes) {
            failed = true
            request.destroy()
            resolve(null)
            return
          }
          chunks.push(chunk)
        })
        response.on('end', () => {
          if (failed) return
          resolve({ bytes: Buffer.concat(chunks), contentType })
        })
        response.on('error', () => resolve(null))
      },
    )
    request.on('timeout', () => {
      request.destroy()
      resolve(null)
    })
    request.on('error', () => resolve(null))
    request.end()
  })
}

async function persistOne(
  item: StoredAttachment,
  index: number,
  keyPrefix: string,
  deps: MediaPersistDeps,
): Promise<StoredAttachment> {
  if ((item.type !== 'image' && item.type !== 'video') || item.persistedSrc || !item.sourceUrl) {
    return { ...item, sourceUrl: null }
  }
  if (!deps.blobToken) return { ...item, sourceUrl: null }
  const fetchBinary = deps.fetchBinary ?? defaultFetchBinary
  const downloaded = await fetchBinary(item.sourceUrl, MAX_MEDIA_BYTES)
  if (!downloaded) {
    deps.log.info('media_download_failed')
    return { ...item, sourceUrl: null }
  }
  const ext = extensionFor(item.type, downloaded.contentType)
  const pathname = `${keyPrefix}/${index}.${ext}`
  try {
    const blob = await put(pathname, downloaded.bytes, {
      access: 'public',
      token: deps.blobToken,
      contentType: downloaded.contentType ?? (item.type === 'image' ? 'image/jpeg' : 'video/mp4'),
      addRandomSuffix: false,
      allowOverwrite: true,
    })
    const thumbnailSrc =
      item.type === 'image' ? await persistThumbnail(downloaded.bytes, downloaded.contentType, pathname, deps) : null
    return { ...item, sourceUrl: null, persistedSrc: blob.url, ...(thumbnailSrc ? { thumbnailSrc } : {}) }
  } catch {
    deps.log.info('media_upload_failed')
    return { ...item, sourceUrl: null }
  }
}

export async function persistAttachmentList(
  items: readonly StoredAttachment[],
  keyPrefix: string,
  deps: MediaPersistDeps,
): Promise<StoredAttachment[]> {
  if (!deps.blobToken || !attachmentsNeedPersist(items)) {
    return attachmentsForStorage(items)
  }
  const out: StoredAttachment[] = []
  for (let index = 0; index < items.length; index += 1) {
    out.push(await persistOne(items[index]!, index, keyPrefix, deps))
  }
  return out
}

export async function persistUpdateAttachments(
  chatId: string,
  messageMid: string,
  attachments: readonly StoredAttachment[],
  deps: MediaPersistDeps,
): Promise<StoredAttachment[]> {
  const keyPrefix = `reviews/${chatId}/${messageMid}`.replace(/[^a-zA-Z0-9/_-]+/g, '_')
  return persistAttachmentList(attachments, keyPrefix, deps)
}

function needsDurableMedia(items: readonly StoredAttachment[]): boolean {
  return items.some((item) => (item.type === 'image' || item.type === 'video') && item.persistedSrc == null)
}

/** Перед модерацией: подтягивает свежие URL через GET /messages и сохраняет файлы в Blob. */
export async function ensureContentMediaPersisted(contentId: string, deps: MediaPersistDeps): Promise<void> {
  if (!deps.blobToken) return
  const content = await deps.store.getGroupContent(contentId)
  if (!content || !needsDurableMedia(content.attachments)) return

  let attachments = content.attachments
  if (!attachmentsNeedPersist(attachments) && deps.max) {
    try {
      const message = await deps.max.getMessage(content.messageMid)
      if (message) {
        attachments = mergeSourceUrls(attachments, readAttachments(message.attachments))
      }
    } catch {
      deps.log.info('media_refresh_failed')
    }
  }

  if (!attachmentsNeedPersist(attachments)) return

  const persisted = await persistUpdateAttachments(content.chatId, content.messageMid, attachments, deps)
  await deps.store.updateGroupAttachments(contentId, persisted)
}
