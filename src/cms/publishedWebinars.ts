import type { Webinar } from './types'
import { fetchGetWithRetry } from '../lib/fetchRetry'

export class WebinarsUnavailable extends Error {
  constructor() {
    super('webinars_unavailable')
    this.name = 'WebinarsUnavailable'
  }
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

/** Записи только из публичного Vercel Blob по https. */
export function isAllowedRecordingSrc(value: unknown): value is string {
  if (typeof value !== 'string') return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false
  return url.hostname.toLowerCase().endsWith('.blob.vercel-storage.com')
}

function readWebinar(item: unknown): Webinar | null {
  if (!item || typeof item !== 'object') return null
  const row = item as Record<string, unknown>
  const id = optionalString(row.id)
  const title = optionalString(row.title)
  if (!id || !title) return null
  const date = typeof row.date === 'string' && DATE.test(row.date) ? row.date : null
  const speaker = optionalString(row.speaker)
  const start = typeof row.startSeconds === 'number' && Number.isInteger(row.startSeconds) && row.startSeconds > 0 && row.startSeconds <= 86_400 ? row.startSeconds : null
  if (row.sourceType === 'youtube') {
    if (typeof row.youtubeVideoId !== 'string' || !YOUTUBE_ID.test(row.youtubeVideoId)) return null
    return { id, title, date, speaker, sourceType: 'youtube', youtubeVideoId: row.youtubeVideoId, startSeconds: start, recordingSrc: null }
  }
  if (row.sourceType === 'hosted') {
    if (!isAllowedRecordingSrc(row.recordingSrc)) return null
    return { id, title, date, speaker, sourceType: 'hosted', youtubeVideoId: null, startSeconds: null, recordingSrc: row.recordingSrc }
  }
  return null
}

/** Оставляет только публичные поля и проверенные источники. Неизвестные записи пропускаются. */
export function parsePublishedWebinars(payload: unknown): Webinar[] {
  if (!payload || typeof payload !== 'object' || !('webinars' in payload) || !Array.isArray(payload.webinars)) {
    throw new WebinarsUnavailable()
  }
  return payload.webinars.map(readWebinar).filter((item): item is Webinar => item !== null)
}

export function youtubeEmbedUrl(videoId: string, startSeconds: number | null): string {
  const params = new URLSearchParams({ rel: '0', playsinline: '1' })
  if (startSeconds) params.set('start', String(startSeconds))
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?${params.toString()}`
}

export function youtubeWatchUrl(videoId: string, startSeconds: number | null): string {
  const params = new URLSearchParams({ v: videoId })
  if (startSeconds) params.set('t', `${startSeconds}s`)
  return `https://www.youtube.com/watch?${params.toString()}`
}

export async function listPublishedWebinars(): Promise<readonly Webinar[]> {
  let response: Response
  try {
    response = await fetchGetWithRetry('/api/webinars', { headers: { accept: 'application/json' } })
  } catch {
    throw new WebinarsUnavailable()
  }
  if (!response.ok) throw new WebinarsUnavailable()
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new WebinarsUnavailable()
  }
  return parsePublishedWebinars(payload)
}
