/*
 * Админ-импорт вебинара в очередь модерации. Ничего не публикует: запись создаётся со status = 'pending',
 * публикует модератор в MAX (/webinars_pending). Секреты не выводятся.
 *
 * YouTube (режим A, официальный плеер youtube-nocookie):
 *   npx tsx --env-file=.env.local scripts/webinar-import.ts --url "https://youtu.be/ID?t=90" --title "Тема" --speaker "Имя" --date 2026-11-05
 * Свой файл (режим B, только если есть право размещать запись; файл уже загружен в Vercel Blob):
 *   npx tsx --env-file=.env.local scripts/webinar-import.ts --hosted-url "https://<store>.public.blob.vercel-storage.com/w.mp4" --title "Тема"
 * Скачивание роликов с YouTube не поддерживается и не нужно.
 */
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { createPostgresStore } from '../server/max/postgresStore'
import type { StoreTx } from '../server/max/store'
import { isAllowedRecordingSrc } from '../server/max/webinars'
import {
  WEBINAR_SPEAKER_MAX,
  WEBINAR_TITLE_MAX,
  fetchYoutubeMetadata,
  parseWebinarDate,
  parseYoutubeUrl,
  type YoutubeMetadata,
} from '../server/max/youtubeImport'

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`)
  const value = index >= 0 ? process.argv[index + 1] : undefined
  return value && !value.startsWith('--') ? value.trim() : null
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

const url = arg('url')
const hosted = arg('hosted-url')
const title = arg('title')
const speaker = arg('speaker')
const dateRaw = arg('date')
if (Boolean(url) === Boolean(hosted)) fail('Укажите ровно одно: --url (YouTube) или --hosted-url (файл в Vercel Blob).')
if (title && title.length > WEBINAR_TITLE_MAX) fail(`Название длиннее ${WEBINAR_TITLE_MAX} символов.`)
if (speaker && speaker.length > WEBINAR_SPEAKER_MAX) fail(`Имя спикера длиннее ${WEBINAR_SPEAKER_MAX} символов.`)
const date = dateRaw ? parseWebinarDate(dateRaw) : null
if (dateRaw && !date) fail('Неверная дата. Формат: 2026-11-05 или 05.11.2026.')

const ref = url ? parseYoutubeUrl(url) : null
if (url && !ref) fail('Ссылка не похожа на ролик YouTube.')
if (hosted && !isAllowedRecordingSrc(hosted)) fail('Файл должен лежать в Vercel Blob (https://*.public.blob.vercel-storage.com/...).')
if (hosted && !title) fail('Для своего файла нужен --title.')

const dbUrl = process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim()
if (!dbUrl) fail('DATABASE_URL is not set.')

let meta: YoutubeMetadata = { status: 'not_configured', title: null, publishedAt: null }
if (ref) meta = await fetchYoutubeMetadata(ref.videoId, { apiKey: process.env.YOUTUBE_API_KEY?.trim() || null })

const pool = new pg.Pool({ connectionString: dbUrl, max: 1 })
try {
  const store = createPostgresStore(pool)
  const nowIso = new Date().toISOString()
  const result = await store.transaction((tx: StoreTx) =>
    tx.upsertWebinar(
      {
        id: randomUUID(),
        title: title ?? meta.title,
        speaker,
        eventDate: date ?? meta.publishedAt?.slice(0, 10) ?? null,
        sourceType: ref ? 'youtube' : 'hosted',
        youtubeVideoId: ref?.videoId ?? null,
        startSeconds: ref?.startSeconds ?? null,
        recordingSrc: hosted,
        youtubeTitle: meta.title,
        youtubePublishedAt: meta.publishedAt,
        metadataStatus: ref ? meta.status : 'hosted',
        createdAt: nowIso,
        contentId: null,
        sourceChatId: null,
        sourceMessageMid: null,
      },
      nowIso,
    ),
  )
  console.log(`результат: ${result.result}, id: ${result.webinar.id}, статус: ${result.webinar.status}, проверка YouTube: ${result.webinar.metadataStatus}`)
  console.log('Опубликовать можно только через MAX: /webinars_pending.')
} finally {
  await pool.end()
}
