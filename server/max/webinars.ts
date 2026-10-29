import type { NewWebinar, PublicWebinar, WebinarPublishResult, WebinarRecord } from './store'
import { blocksPublication, YOUTUBE_ID } from './youtubeImport'

const BLOB_HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.blob\.vercel-storage\.com$/

/** Разрешённый адрес записи режима B: только https в Vercel Blob проекта. */
export function isAllowedRecordingSrc(src: string | null): boolean {
  if (!src) return false
  try {
    const url = new URL(src)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && BLOB_HOST.test(url.hostname)
  } catch {
    return false
  }
}

/** Проверка источника перед публикацией. Используется обоими хранилищами под блокировкой строки. */
export function publishCheck(record: WebinarRecord): WebinarPublishResult | null {
  if (record.status !== 'pending') return 'not_pending'
  if (!record.title || record.title.trim().length === 0) return 'needs_title'
  if (record.sourceType === 'youtube') {
    if (!record.youtubeVideoId || !YOUTUBE_ID.test(record.youtubeVideoId) || record.recordingSrc) return 'blocked_source'
    if (blocksPublication(record.metadataStatus)) return 'blocked_source'
    return null
  }
  if (!isAllowedRecordingSrc(record.recordingSrc)) return 'blocked_source'
  return null
}

export function toPublicWebinar(record: WebinarRecord): PublicWebinar | null {
  if (record.status !== 'published' || record.withdrawnAt != null || !record.title) return null
  if (record.sourceType === 'youtube' && (!record.youtubeVideoId || !YOUTUBE_ID.test(record.youtubeVideoId))) return null
  if (record.sourceType === 'hosted' && !isAllowedRecordingSrc(record.recordingSrc)) return null
  return {
    id: record.id,
    title: record.title,
    speaker: record.speaker,
    date: record.eventDate,
    sourceType: record.sourceType,
    youtubeVideoId: record.sourceType === 'youtube' ? record.youtubeVideoId : null,
    startSeconds: record.sourceType === 'youtube' ? record.startSeconds : null,
    recordingSrc: record.sourceType === 'hosted' ? record.recordingSrc : null,
  }
}

export function newWebinarRecord(input: NewWebinar, nowIso: string): WebinarRecord {
  return {
    ...input,
    status: 'pending',
    updatedAt: nowIso,
    publishedAt: null,
    withdrawnAt: null,
    moderatorUserId: null,
  }
}

/** Поля, которые переписываются при повторном импорте того же ролика (reopen). */
export function reopenedRecord(existing: WebinarRecord, input: NewWebinar, nowIso: string): WebinarRecord {
  return {
    ...existing,
    title: input.title,
    speaker: input.speaker,
    eventDate: input.eventDate,
    startSeconds: input.startSeconds,
    youtubeTitle: input.youtubeTitle,
    youtubePublishedAt: input.youtubePublishedAt,
    metadataStatus: input.metadataStatus,
    contentId: input.contentId,
    sourceChatId: input.sourceChatId,
    sourceMessageMid: input.sourceMessageMid,
    status: 'pending',
    updatedAt: nowIso,
    publishedAt: null,
    withdrawnAt: null,
    moderatorUserId: null,
  }
}
