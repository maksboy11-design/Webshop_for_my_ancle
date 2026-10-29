/*
 * Обратная генерация WebP-миниатюр для фото уже опубликованных отзывов (список Mini App модератора).
 * - Оригиналы не удаляются и не перезаписываются; миниатюра кладётся рядом: reviews/.../0.thumb.webp.
 * - Идемпотентно: фото с thumbnailSrc пропускаются; путь миниатюры стабильный, дублей нет.
 * - Можно перезапускать после сбоя: каждая запись обновляется отдельно и только если её media не изменилось
 *   (сравнение jsonb), чтобы не затереть параллельную правку модератора.
 * - Выводит только счётчики и id отзывов; тексты, авторы, токены и URL БД не печатаются.
 *
 * Запуск (по умолчанию dry-run, ничего не пишет):
 *   npx tsx --env-file=.env.local scripts/backfill-review-thumbnails.ts
 *   npx tsx --env-file=.env.local scripts/backfill-review-thumbnails.ts --apply [--limit=50]
 * Нужны DATABASE_URL (или DATABASE_URL_UNPOOLED) и BLOB_READ_WRITE_TOKEN (только для --apply).
 */
import { put } from '@vercel/blob'
import pg from 'pg'
import { makeThumbnail, thumbnailPathFor, THUMB_MAX_INPUT_BYTES } from '../server/max/thumbnail'
import { imagesNeedingThumbnail, withThumbnails } from '../server/max/thumbnailBackfill'

const apply = process.argv.includes('--apply')
const limitArg = process.argv.find((a) => a.startsWith('--limit='))
const limit = limitArg ? Math.max(1, Number(limitArg.slice(8)) || 0) : 1000
const dbUrl = process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim()
const blobToken = process.env.BLOB_READ_WRITE_TOKEN?.trim() || null
if (!dbUrl) {
  console.error('DATABASE_URL is not set.')
  process.exit(1)
}
if (apply && !blobToken) {
  console.error('BLOB_READ_WRITE_TOKEN is not set (needed for --apply).')
  process.exit(1)
}

async function download(src: string): Promise<{ bytes: Buffer; contentType: string | null } | null> {
  try {
    const res = await fetch(src, { redirect: 'error', signal: AbortSignal.timeout(20_000) })
    if (!res.ok) return null
    const declared = Number(res.headers.get('content-length') ?? '0')
    if (declared > THUMB_MAX_INPUT_BYTES) return null
    const bytes = Buffer.from(await res.arrayBuffer())
    if (bytes.length > THUMB_MAX_INPUT_BYTES) return null
    return { bytes, contentType: res.headers.get('content-type') }
  } catch {
    return null
  }
}

const client = new pg.Client({ connectionString: dbUrl })
await client.connect()
const stats = { reviews: 0, reviewsNeeding: 0, images: 0, created: 0, failed: 0, updated: 0, skippedConcurrent: 0 }
try {
  const rows = await client.query<{ id: string; media: unknown }>(
    `SELECT id::text, media FROM product_reviews
     WHERE status = 'published' AND withdrawn_at IS NULL AND media IS NOT NULL
     ORDER BY decided_at DESC NULLS LAST
     LIMIT $1`,
    [limit],
  )
  for (const row of rows.rows) {
    stats.reviews += 1
    const todo = imagesNeedingThumbnail(row.media)
    if (todo.length === 0) continue
    stats.reviewsNeeding += 1
    stats.images += todo.length
    if (!apply) continue
    const bySrc = new Map<string, string>()
    for (const item of todo) {
      const original = await download(item.src)
      const thumb = original ? await makeThumbnail(original.bytes, original.contentType) : null
      if (!thumb) {
        stats.failed += 1
        continue
      }
      try {
        const blob = await put(thumbnailPathFor(item.pathname), thumb, {
          access: 'public',
          token: blobToken!,
          contentType: 'image/webp',
          addRandomSuffix: false,
          allowOverwrite: true,
          cacheControlMaxAge: 31_536_000,
        })
        bySrc.set(item.src, blob.url)
        stats.created += 1
      } catch {
        stats.failed += 1
      }
    }
    if (bySrc.size === 0) continue
    const next = withThumbnails(row.media, bySrc)
    if (next.changed === 0) continue
    const result = await client.query(
      `UPDATE product_reviews SET media = $2::jsonb
       WHERE id = $1::uuid AND status = 'published' AND withdrawn_at IS NULL AND media = $3::jsonb`,
      [row.id, JSON.stringify(next.media), JSON.stringify(row.media)],
    )
    if (result.rowCount === 1) {
      stats.updated += 1
      console.log(`updated review ${row.id}: +${next.changed} thumbnails`)
    } else {
      stats.skippedConcurrent += 1
    }
  }
} finally {
  await client.end()
}
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...stats }))
