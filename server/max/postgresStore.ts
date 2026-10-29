import { randomUUID } from 'node:crypto'
import { publicMediaOf, type StoredAttachment } from './attachments'
import type { ContentKind } from './classify'
import type { InlineKeyboard } from './maxClient'
import { codePointLength, REVIEW_TEXT_MAX } from './text'
import type {
  ContentStatus,
  IncomingContent,
  NewJob,
  NewReview,
  OutboxJob,
  PendingReview,
  PublicReview,
  ReviewStore,
  SessionRecord,
  StoreTx,
  WebinarMetadataStatus,
  WebinarRecord,
  WebinarSourceType,
  WebinarStatus,
} from './store'
import { newWebinarRecord, publishCheck, reopenedRecord, toPublicWebinar } from './webinars'
import {
  productIdsMatchingWord,
  searchWords,
  toAdminItem,
} from './publishedReviewSearch'

export interface SqlClient {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>
  release(): void
}

export interface SqlPool {
  connect(): Promise<SqlClient>
}

function asKeyboard(value: unknown): InlineKeyboard | null {
  if (!value || typeof value !== 'object') return null
  return value as InlineKeyboard
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function publicMediaFromJson(value: unknown): PublicReview['media'] {
  if (!Array.isArray(value)) return []
  const media: PublicReview['media'] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (row.type !== 'image' && row.type !== 'video') continue
    if (typeof row.src !== 'string' || row.src.length === 0) continue
    media.push({
      type: row.type,
      src: row.src,
      poster: typeof row.poster === 'string' ? row.poster : null,
      alt: typeof row.alt === 'string' ? row.alt : null,
    })
  }
  return media
}

function attachmentsOf(value: unknown): StoredAttachment[] {
  if (!Array.isArray(value)) return []
  const stored: StoredAttachment[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (row.type !== 'image' && row.type !== 'video' && row.type !== 'unsupported') continue
    stored.push({
      type: row.type,
      token: textOrNull(row.token),
      photoId: textOrNull(row.photoId),
      width: typeof row.width === 'number' ? row.width : null,
      height: typeof row.height === 'number' ? row.height : null,
      duration: typeof row.duration === 'number' ? row.duration : null,
      size: typeof row.size === 'number' ? row.size : null,
      sourceUrl: null,
      persistedSrc: textOrNull(row.persistedSrc),
    })
  }
  return stored
}

function contentFrom(row: {
  id: string
  chat_id: string
  message_mid: string
  received_at: string
  kind: ContentKind
  body_text: string | null
  public_text: string | null
  attachments: unknown
  status: ContentStatus
  published_review_id: string | null
}): IncomingContent {
  return {
    id: row.id,
    chatId: row.chat_id,
    messageMid: row.message_mid,
    receivedAt: row.received_at,
    kind: row.kind,
    text: textOrNull(row.body_text),
    publicText: textOrNull(row.public_text),
    attachments: attachmentsOf(row.attachments),
    status: row.status,
    publishedReviewId: textOrNull(row.published_review_id),
  }
}

const WEBINAR_COLUMNS = `id::text, title, speaker, to_char(event_date, 'YYYY-MM-DD') AS event_date, source_type,
  youtube_video_id, start_seconds, recording_src, youtube_title, youtube_published_at::text, metadata_status, status,
  created_at::text, updated_at::text, published_at::text, withdrawn_at::text, moderator_user_id::text,
  content_id::text, source_chat_id::text, source_message_mid`

interface WebinarRow extends Record<string, unknown> {
  id: string
  title: string | null
  speaker: string | null
  event_date: string | null
  source_type: WebinarSourceType
  youtube_video_id: string | null
  start_seconds: number | null
  recording_src: string | null
  youtube_title: string | null
  youtube_published_at: string | null
  metadata_status: WebinarMetadataStatus
  status: WebinarStatus
  created_at: string
  updated_at: string
  published_at: string | null
  withdrawn_at: string | null
  moderator_user_id: string | null
  content_id: string | null
  source_chat_id: string | null
  source_message_mid: string | null
}

function webinarFrom(row: WebinarRow): WebinarRecord {
  return {
    id: row.id,
    title: textOrNull(row.title),
    speaker: textOrNull(row.speaker),
    eventDate: textOrNull(row.event_date),
    sourceType: row.source_type,
    youtubeVideoId: textOrNull(row.youtube_video_id),
    startSeconds: typeof row.start_seconds === 'number' ? row.start_seconds : null,
    recordingSrc: textOrNull(row.recording_src),
    youtubeTitle: textOrNull(row.youtube_title),
    youtubePublishedAt: textOrNull(row.youtube_published_at),
    metadataStatus: row.metadata_status,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: textOrNull(row.published_at),
    withdrawnAt: textOrNull(row.withdrawn_at),
    moderatorUserId: textOrNull(row.moderator_user_id),
    contentId: textOrNull(row.content_id),
    sourceChatId: textOrNull(row.source_chat_id),
    sourceMessageMid: textOrNull(row.source_message_mid),
  }
}

function webinarValues(record: WebinarRecord): unknown[] {
  return [
    record.id,
    record.title,
    record.speaker,
    record.eventDate,
    record.sourceType,
    record.youtubeVideoId,
    record.startSeconds,
    record.recordingSrc,
    record.youtubeTitle,
    record.youtubePublishedAt,
    record.metadataStatus,
    record.status,
    record.createdAt,
    record.updatedAt,
    record.publishedAt,
    record.withdrawnAt,
    record.moderatorUserId,
    record.contentId,
    record.sourceChatId,
    record.sourceMessageMid,
  ]
}

const WEBINAR_WRITE_SET = `title = $2, speaker = $3, event_date = $4::date, source_type = $5, youtube_video_id = $6,
  start_seconds = $7, recording_src = $8, youtube_title = $9, youtube_published_at = $10::timestamptz,
  metadata_status = $11, status = $12, created_at = $13::timestamptz, updated_at = $14::timestamptz,
  published_at = $15::timestamptz, withdrawn_at = $16::timestamptz, moderator_user_id = $17::bigint,
  content_id = $18::uuid, source_chat_id = $19::bigint, source_message_mid = $20`

export function createPostgresStore(pool: SqlPool): ReviewStore {
  async function withClient<T>(fn: (client: SqlClient) => Promise<T>): Promise<T> {
    const client = await pool.connect()
    try {
      return await fn(client)
    } finally {
      client.release()
    }
  }

  function tx(client: SqlClient): StoreTx {
    return {
      async claim(key, updateType) {
        const result = await client.query<{ idempotency_key: string }>(
          `INSERT INTO max_update_receipts (idempotency_key, update_type)
           VALUES ($1, $2)
           ON CONFLICT (idempotency_key) DO NOTHING
           RETURNING idempotency_key`,
          [key, updateType],
        )
        return result.rows.length > 0 ? 'new' : 'duplicate'
      },
      async getSession(userId, nowIso) {
        const removed = await client.query(
          `DELETE FROM review_sessions
           WHERE user_id = $1::bigint AND expires_at <= $2::timestamptz
           RETURNING user_id`,
          [userId, nowIso],
        )
        if (removed.rows.length > 0) return { status: 'expired' }
        const result = await client.query<{
          step: SessionRecord['step']
          product_id: string | null
          draft_text: string | null
          author_name: string | null
          expires_at: string
        }>(
          `SELECT step, product_id, draft_text, author_name, expires_at::text
           FROM review_sessions
           WHERE user_id = $1::bigint AND expires_at > $2::timestamptz`,
          [userId, nowIso],
        )
        const row = result.rows[0]
        if (!row) return { status: 'none' }
        return {
          status: 'active',
          session: {
            step: row.step,
            productId: row.product_id,
            draftText: row.draft_text,
            authorName: row.author_name,
            expiresAt: row.expires_at,
          },
        }
      },
      async putSession(userId, session, nowIso) {
        await client.query(
          `INSERT INTO review_sessions
             (user_id, step, product_id, draft_text, author_name, expires_at, updated_at)
           VALUES ($1::bigint, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz)
           ON CONFLICT (user_id) DO UPDATE SET
             step = EXCLUDED.step,
             product_id = EXCLUDED.product_id,
             draft_text = EXCLUDED.draft_text,
             author_name = EXCLUDED.author_name,
             expires_at = EXCLUDED.expires_at,
             updated_at = EXCLUDED.updated_at`,
          [userId, session.step, session.productId, session.draftText, session.authorName, session.expiresAt, nowIso],
        )
      },
      async deleteSession(userId) {
        await client.query(`DELETE FROM review_sessions WHERE user_id = $1::bigint`, [userId])
      },
      async insertPending(review: NewReview) {
        await client.query(
          `INSERT INTO product_reviews (
             id, product_id, body, author_name, status, source,
             received_at, consent_at, idempotency_key, sender_user_id
           ) VALUES (
             $1::uuid, $2, $3, $4, 'pending', 'MAX',
             $5::timestamptz, $6::timestamptz, $7, $8::bigint
           )
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [
            review.id,
            review.productId,
            review.text,
            review.author,
            review.receivedAt,
            review.consentAt,
            review.idempotencyKey,
            review.senderUserId,
          ],
        )
      },
      async listPending(limit) {
        const result = await client.query<{
          id: string
          product_id: string
          body: string
          author_name: string | null
          received_at: string
        }>(
          `SELECT id::text, product_id, body, author_name, received_at::text
           FROM product_reviews
           WHERE status = 'pending'
           ORDER BY received_at ASC, id ASC
           LIMIT $1`,
          [limit],
        )
        return result.rows.map(
          (row): PendingReview => ({
            id: row.id,
            productId: row.product_id,
            text: row.body,
            author: row.author_name,
            receivedAt: row.received_at,
          }),
        )
      },
      async countPending() {
        const result = await client.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM product_reviews WHERE status = 'pending'`,
        )
        return result.rows[0]?.count ?? 0
      },
      async decide(id, status, moderatorUserId, atIso) {
        const result = await client.query(
          `UPDATE product_reviews
           SET status = $2, decided_at = $3::timestamptz, moderator_user_id = $4::bigint
           WHERE id = $1::uuid AND status = 'pending'
           RETURNING id`,
          [id, status, atIso, moderatorUserId],
        )
        if (result.rows.length > 0) return 'updated'
        const existing = await client.query(`SELECT status FROM product_reviews WHERE id = $1::uuid`, [id])
        return existing.rows.length > 0 ? 'not_pending' : 'missing'
      },
      async enqueue(key, jobs: NewJob[]) {
        for (let position = 0; position < jobs.length; position += 1) {
          const job = jobs[position]
          if (!job) continue
          await client.query(
            `INSERT INTO review_outbox (
               id, idempotency_key, position, kind, chat_id, user_id, callback_id,
               body_text, attachments, notification
             ) VALUES (
               $1::uuid, $2, $3, $4, $5::bigint, $6::bigint, $7, $8, $9::jsonb, $10
             )`,
            [
              randomUUID(),
              key,
              position,
              job.kind,
              job.chatId,
              job.userId,
              job.callbackId,
              job.text,
              job.attachments ? JSON.stringify(job.attachments) : null,
              job.notification,
            ],
          )
        }
      },
      async countActions(userId, sinceIso) {
        const result = await client.query<{ count: number }>(
          `SELECT count(*)::int AS count
           FROM review_intake_events
           WHERE user_id = $1::bigint AND created_at >= $2::timestamptz`,
          [userId, sinceIso],
        )
        return result.rows[0]?.count ?? 0
      },
      async recordAction(userId, atIso) {
        await client.query(
          `INSERT INTO review_intake_events (user_id, created_at) VALUES ($1::bigint, $2::timestamptz)`,
          [userId, atIso],
        )
      },
      async pruneActions(beforeIso) {
        await client.query(`DELETE FROM review_intake_events WHERE created_at < $1::timestamptz`, [beforeIso])
      },
      async findGroupMessage(chatId, messageMid) {
        const result = await client.query<{
          id: string
          chat_id: string
          message_mid: string
          received_at: string
          kind: ContentKind
          body_text: string | null
          public_text: string | null
          attachments: unknown
          status: ContentStatus
          published_review_id: string | null
        }>(
          `SELECT id::text, chat_id::text, message_mid, received_at::text, kind, body_text, public_text,
                  attachments, status, published_review_id::text
           FROM incoming_content
           WHERE chat_id = $1::bigint AND message_mid = $2`,
          [chatId, messageMid],
        )
        const row = result.rows[0]
        return row ? contentFrom(row) : null
      },
      async countGroupMessages(chatId, sinceIso) {
        const result = await client.query<{ count: number }>(
          `SELECT count(*)::int AS count
           FROM incoming_content
           WHERE chat_id = $1::bigint AND received_at >= $2::timestamptz`,
          [chatId, sinceIso],
        )
        return result.rows[0]?.count ?? 0
      },
      async insertGroupMessage(content) {
        const result = await client.query(
          `INSERT INTO incoming_content (
             id, chat_id, message_mid, received_at, kind, body_text, public_text,
             attachments, status, idempotency_key
           ) VALUES (
             $1::uuid, $2::bigint, $3, $4::timestamptz, $5, $6, $7, $8::jsonb, $9, $10
           )
           ON CONFLICT (chat_id, message_mid) DO NOTHING
           RETURNING id`,
          [
            content.id,
            content.chatId,
            content.messageMid,
            content.receivedAt,
            content.kind,
            content.text,
            content.publicText,
            JSON.stringify(content.attachments),
            content.status,
            content.idempotencyKey,
          ],
        )
        return result.rows.length > 0 ? 'created' : 'duplicate'
      },
      async replaceGroupMessage(content, editedAt) {
        const existing = await client.query<{ id: string; status: ContentStatus; published_review_id: string | null }>(
          `SELECT id::text, status, published_review_id::text
           FROM incoming_content
           WHERE chat_id = $1::bigint AND message_mid = $2
           FOR UPDATE`,
          [content.chatId, content.messageMid],
        )
        const row = existing.rows[0]
        if (!row) return 'missing'
        if (row.status === 'removed') return 'removed'
        if (row.published_review_id) {
          await client.query(
            `UPDATE product_reviews SET withdrawn_at = $2::timestamptz WHERE id = $1::uuid AND withdrawn_at IS NULL`,
            [row.published_review_id, editedAt],
          )
        }
        await client.query(
          `UPDATE incoming_content
           SET edited_at = $2::timestamptz,
               kind = $3,
               body_text = $4,
               public_text = $5,
               attachments = $6::jsonb,
               status = $7,
               published_review_id = NULL
           WHERE id = $1::uuid`,
          [
            row.id,
            editedAt,
            content.kind,
            content.text,
            content.publicText,
            JSON.stringify(content.attachments),
            content.status === 'empty' ? 'empty' : 'pending',
          ],
        )
        return 'updated'
      },
      async removeGroupMessage(chatId, messageMid) {
        const existing = await client.query<{ id: string; published_review_id: string | null; received_at: string }>(
          `SELECT id::text, published_review_id::text, received_at::text
           FROM incoming_content
           WHERE chat_id = $1::bigint AND message_mid = $2
           FOR UPDATE`,
          [chatId, messageMid],
        )
        const row = existing.rows[0]
        if (!row) return 'missing'
        if (row.published_review_id) {
          await client.query(
            `UPDATE product_reviews SET withdrawn_at = COALESCE(withdrawn_at, $2::timestamptz) WHERE id = $1::uuid`,
            [row.published_review_id, row.received_at],
          )
        }
        await client.query(`UPDATE incoming_content SET status = 'removed' WHERE id = $1::uuid`, [row.id])
        return 'removed'
      },
      async listPendingGroup(limit, scope = 'review') {
        const result = await client.query<{
          id: string
          chat_id: string
          message_mid: string
          received_at: string
          kind: ContentKind
          body_text: string | null
          public_text: string | null
          attachments: unknown
          status: ContentStatus
          published_review_id: string | null
        }>(
          `SELECT id::text, chat_id::text, message_mid, received_at::text, kind, body_text, public_text,
                  attachments, status, published_review_id::text
           FROM incoming_content
           WHERE status = 'pending' AND (($2 = 'review' AND kind = 'review') OR ($2 = 'other' AND kind NOT IN ('review', 'webinar')))
           ORDER BY received_at ASC, id ASC
           LIMIT $1`,
          [limit, scope],
        )
        return result.rows.map(contentFrom)
      },
      async publishGroupReview(id, productId, moderatorUserId, atIso) {
        const existing = await client.query<{
          status: ContentStatus
          kind: ContentKind
          public_text: string | null
          received_at: string
          attachments: unknown
        }>(
          `SELECT status, kind, public_text, received_at::text, attachments
           FROM incoming_content
           WHERE id = $1::uuid
           FOR UPDATE`,
          [id],
        )
        const row = existing.rows[0]
        if (!row) return 'missing'
        if (row.status !== 'pending' || row.kind !== 'review') return 'not_pending'
        if (!row.public_text) return 'needs_text'
        if (codePointLength(row.public_text) > REVIEW_TEXT_MAX) return 'too_long'
        const reviewId = randomUUID()
        const media = publicMediaOf(attachmentsOf(row.attachments))
        await client.query(
          `INSERT INTO product_reviews (
             id, product_id, body, author_name, status, source,
             received_at, consent_at, decided_at, moderator_user_id, idempotency_key, sender_user_id, media
           ) VALUES (
             $1::uuid, $2, $3, NULL, 'published', 'MAX',
             $4::timestamptz, $4::timestamptz, $5::timestamptz, $6::bigint, $7, NULL, $8::jsonb
           )`,
          [reviewId, productId, row.public_text, row.received_at, atIso, moderatorUserId, `group-review:${reviewId}`, JSON.stringify(media)],
        )
        await client.query(
          `UPDATE incoming_content
           SET status = 'published', published_review_id = $2::uuid
           WHERE id = $1::uuid`,
          [id, reviewId],
        )
        return 'published'
      },
      async rejectGroup(id) {
        const result = await client.query(
          `UPDATE incoming_content
           SET status = 'rejected'
           WHERE id = $1::uuid AND status = 'pending'
           RETURNING id`,
          [id],
        )
        if (result.rows.length > 0) return 'rejected'
        const existing = await client.query(`SELECT id FROM incoming_content WHERE id = $1::uuid`, [id])
        return existing.rows.length > 0 ? 'not_pending' : 'missing'
      },
      async listPublishedReviews(limit, offset) {
        const result = await client.query<{
          id: string
          product_id: string
          author_name: string | null
          body: string
          media: unknown
          decided_at: string | null
        }>(
          `SELECT id::text, product_id, author_name, body, media, decided_at::text
           FROM product_reviews
           WHERE status = 'published' AND withdrawn_at IS NULL
           ORDER BY decided_at DESC NULLS LAST, id ASC
           LIMIT $1 OFFSET $2`,
          [limit, offset],
        )
        return result.rows.map((row) => {
          const media = publicMediaFromJson(row.media)
          const photosCount = media.filter((m) => m.type === 'image').length
          const videosCount = media.filter((m) => m.type === 'video').length
          return {
            id: row.id,
            productId: row.product_id,
            author: row.author_name,
            text: row.body,
            mediaCount: photosCount + videosCount,
            photosCount,
            videosCount,
            publishedAt: row.decided_at,
          }
        })
      },
      async countPublishedReviews() {
        const result = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM product_reviews WHERE status = 'published' AND withdrawn_at IS NULL`,
        )
        return Number(result.rows[0]?.count ?? 0)
      },
      async searchPublishedReviews(query) {
        const words = searchWords(query.q)
        const values: unknown[] = []
        const where: string[] = [`status = 'published'`, `withdrawn_at IS NULL`]

        const photosExpr = `(SELECT count(*)::int FROM jsonb_array_elements(COALESCE(media, '[]'::jsonb)) elem WHERE elem->>'type' = 'image')`
        const videosExpr = `(SELECT count(*)::int FROM jsonb_array_elements(COALESCE(media, '[]'::jsonb)) elem WHERE elem->>'type' = 'video')`
        if (query.photos != null) {
          values.push(query.photos)
          where.push(`${photosExpr} = $${values.length}`)
        }
        if (query.videos != null) {
          values.push(query.videos)
          where.push(`${videosExpr} = $${values.length}`)
        }

        for (const word of words) {
          const productIds = productIdsMatchingWord(word)
          values.push(word)
          const wordParam = values.length
          if (productIds.length > 0) {
            values.push(productIds)
            const productsParam = values.length
            where.push(
              `(strpos(lower(body), lower($${wordParam})) > 0 OR strpos(lower(COALESCE(author_name, '')), lower($${wordParam})) > 0 OR product_id = ANY($${productsParam}::text[]))`,
            )
          } else {
            where.push(
              `(strpos(lower(body), lower($${wordParam})) > 0 OR strpos(lower(COALESCE(author_name, '')), lower($${wordParam})) > 0)`,
            )
          }
        }

        const whereSql = where.join(' AND ')
        const countResult = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM product_reviews WHERE ${whereSql}`,
          values,
        )
        const total = Number(countResult.rows[0]?.count ?? 0)
        values.push(query.limit)
        const limitParam = values.length
        values.push(query.offset)
        const offsetParam = values.length
        const result = await client.query<{
          id: string
          product_id: string
          author_name: string | null
          body: string
          media: unknown
          decided_at: string | null
        }>(
          `SELECT id::text, product_id, author_name, body, media, decided_at::text
           FROM product_reviews
           WHERE ${whereSql}
           ORDER BY decided_at DESC NULLS LAST, id ASC
           LIMIT $${limitParam} OFFSET $${offsetParam}`,
          values,
        )
        const items = result.rows.map((row) =>
          toAdminItem({
            id: row.id,
            productId: row.product_id,
            author: row.author_name,
            text: row.body,
            media: publicMediaFromJson(row.media),
            publishedAt: row.decided_at,
          }),
        )
        return { total, items }
      },
      async getPublishedReview(id) {
        const result = await client.query<{
          id: string
          product_id: string
          author_name: string | null
          body: string
          media: unknown
          decided_at: string | null
        }>(
          `SELECT id::text, product_id, author_name, body, media, decided_at::text
           FROM product_reviews
           WHERE id = $1::uuid AND status = 'published' AND withdrawn_at IS NULL`,
          [id],
        )
        const row = result.rows[0]
        if (!row) return null
        return toAdminItem({
          id: row.id,
          productId: row.product_id,
          author: row.author_name,
          text: row.body,
          media: publicMediaFromJson(row.media),
          publishedAt: row.decided_at,
        })
      },
      async withdrawReview(id, moderatorUserId, atIso) {
        const result = await client.query(
          `UPDATE product_reviews
           SET withdrawn_at = $3::timestamptz, withdrawn_by_user_id = $2::bigint
           WHERE id = $1::uuid AND status = 'published' AND withdrawn_at IS NULL
           RETURNING id`,
          [id, moderatorUserId, atIso],
        )
        if (result.rows.length > 0) return 'withdrawn'
        const existing = await client.query(`SELECT id FROM product_reviews WHERE id = $1::uuid`, [id])
        return existing.rows.length > 0 ? 'not_published' : 'missing'
      },
      async editPublishedReview(id, patch) {
        const found = await client.query<{ status: string; withdrawn_at: string | null; media: unknown }>(
          `SELECT status, withdrawn_at::text, media FROM product_reviews WHERE id = $1::uuid FOR UPDATE`,
          [id],
        )
        const row = found.rows[0]
        if (!row) return { result: 'missing' }
        if (row.status !== 'published' || row.withdrawn_at != null) return { result: 'not_published' }
        const remove = new Set(patch.removeMediaSrc ?? [])
        const raw = Array.isArray(row.media) ? (row.media as unknown[]) : []
        const kept = raw.filter((item) => {
          if (!item || typeof item !== 'object') return true
          const src = (item as Record<string, unknown>).src
          return !(typeof src === 'string' && remove.has(src))
        })
        await client.query(
          `UPDATE product_reviews
           SET body = COALESCE($2::text, body),
               author_name = CASE WHEN $3::boolean THEN $4::text ELSE author_name END,
               product_id = COALESCE($5::text, product_id),
               media = $6::jsonb
           WHERE id = $1::uuid`,
          [
            id,
            patch.text ?? null,
            patch.author !== undefined,
            patch.author ?? null,
            patch.productId ?? null,
            JSON.stringify(kept),
          ],
        )
        return { result: 'updated', removedMedia: raw.length - kept.length }
      },
      async upsertWebinar(input, nowIso) {
        if (input.youtubeVideoId) {
          const found = await client.query<WebinarRow>(
            `SELECT ${WEBINAR_COLUMNS} FROM webinars WHERE youtube_video_id = $1 FOR UPDATE`,
            [input.youtubeVideoId],
          )
          const row = found.rows[0]
          if (row) {
            const existing = webinarFrom(row)
            if (existing.status === 'pending' || existing.status === 'published') return { result: 'duplicate', webinar: existing }
            const reopened = reopenedRecord(existing, input, nowIso)
            await client.query(`UPDATE webinars SET ${WEBINAR_WRITE_SET} WHERE id = $1::uuid`, webinarValues(reopened))
            return { result: 'reopened', webinar: reopened }
          }
        }
        const created = newWebinarRecord(input, nowIso)
        const inserted = await client.query(
          `INSERT INTO webinars (
             id, title, speaker, event_date, source_type, youtube_video_id, start_seconds, recording_src,
             youtube_title, youtube_published_at, metadata_status, status, created_at, updated_at,
             published_at, withdrawn_at, moderator_user_id, content_id, source_chat_id, source_message_mid
           ) VALUES (
             $1::uuid, $2, $3, $4::date, $5, $6, $7, $8, $9, $10::timestamptz, $11, $12, $13::timestamptz,
             $14::timestamptz, $15::timestamptz, $16::timestamptz, $17::bigint, $18::uuid, $19::bigint, $20
           )
           ON CONFLICT (youtube_video_id) DO NOTHING
           RETURNING id`,
          webinarValues(created),
        )
        if (inserted.rows.length === 0 && input.youtubeVideoId) {
          const raced = await client.query<WebinarRow>(`SELECT ${WEBINAR_COLUMNS} FROM webinars WHERE youtube_video_id = $1`, [input.youtubeVideoId])
          const row = raced.rows[0]
          if (row) return { result: 'duplicate', webinar: webinarFrom(row) }
        }
        return { result: 'created', webinar: created }
      },
      async getWebinar(id) {
        const result = await client.query<WebinarRow>(`SELECT ${WEBINAR_COLUMNS} FROM webinars WHERE id = $1::uuid`, [id])
        const row = result.rows[0]
        return row ? webinarFrom(row) : null
      },
      async findWebinarByContent(contentId) {
        const result = await client.query<WebinarRow>(
          `SELECT ${WEBINAR_COLUMNS} FROM webinars WHERE content_id = $1::uuid ORDER BY updated_at DESC LIMIT 1`,
          [contentId],
        )
        const row = result.rows[0]
        return row ? webinarFrom(row) : null
      },
      async listWebinars(status, limit, offset) {
        const order = status === 'pending' ? 'created_at ASC, id ASC' : status === 'published' ? 'published_at DESC, id ASC' : 'updated_at DESC, id ASC'
        const result = await client.query<WebinarRow>(
          `SELECT ${WEBINAR_COLUMNS} FROM webinars WHERE status = $1 ORDER BY ${order} LIMIT $2 OFFSET $3`,
          [status, limit, offset],
        )
        return result.rows.map(webinarFrom)
      },
      async countWebinars(status) {
        const result = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM webinars WHERE status = $1`, [status])
        return Number(result.rows[0]?.count ?? 0)
      },
      async updatePendingWebinar(id, fields, nowIso) {
        const result = await client.query(
          `UPDATE webinars
           SET title = $2, speaker = $3, event_date = $4::date, youtube_title = $5,
               youtube_published_at = $6::timestamptz, metadata_status = $7, updated_at = $8::timestamptz
           WHERE id = $1::uuid AND status = 'pending'
           RETURNING id`,
          [id, fields.title, fields.speaker, fields.eventDate, fields.youtubeTitle, fields.youtubePublishedAt, fields.metadataStatus, nowIso],
        )
        if (result.rows.length > 0) return 'updated'
        const existing = await client.query(`SELECT id FROM webinars WHERE id = $1::uuid`, [id])
        return existing.rows.length > 0 ? 'not_pending' : 'missing'
      },
      async publishWebinar(id, moderatorUserId, atIso) {
        const found = await client.query<WebinarRow>(`SELECT ${WEBINAR_COLUMNS} FROM webinars WHERE id = $1::uuid FOR UPDATE`, [id])
        const row = found.rows[0]
        if (!row) return 'missing'
        const record = webinarFrom(row)
        const blocked = publishCheck(record)
        if (blocked) return blocked
        await client.query(
          `UPDATE webinars
           SET status = 'published', published_at = $3::timestamptz, withdrawn_at = NULL,
               moderator_user_id = $2::bigint, updated_at = $3::timestamptz
           WHERE id = $1::uuid`,
          [id, moderatorUserId, atIso],
        )
        if (record.contentId) {
          await client.query(`UPDATE incoming_content SET status = 'published' WHERE id = $1::uuid AND status = 'pending'`, [record.contentId])
        }
        return 'published'
      },
      async rejectWebinar(id, moderatorUserId, atIso) {
        const result = await client.query<{ content_id: string | null }>(
          `UPDATE webinars
           SET status = 'rejected', moderator_user_id = $2::bigint, updated_at = $3::timestamptz
           WHERE id = $1::uuid AND status = 'pending'
           RETURNING content_id::text`,
          [id, moderatorUserId, atIso],
        )
        const row = result.rows[0]
        if (row) {
          if (row.content_id) {
            await client.query(`UPDATE incoming_content SET status = 'rejected' WHERE id = $1::uuid AND status = 'pending'`, [row.content_id])
          }
          return 'rejected'
        }
        const existing = await client.query(`SELECT id FROM webinars WHERE id = $1::uuid`, [id])
        return existing.rows.length > 0 ? 'not_pending' : 'missing'
      },
      async withdrawWebinar(id, moderatorUserId, atIso) {
        const result = await client.query(
          `UPDATE webinars
           SET status = 'withdrawn', withdrawn_at = $3::timestamptz, moderator_user_id = $2::bigint, updated_at = $3::timestamptz
           WHERE id = $1::uuid AND status = 'published'
           RETURNING id`,
          [id, moderatorUserId, atIso],
        )
        if (result.rows.length > 0) return 'withdrawn'
        const existing = await client.query(`SELECT id FROM webinars WHERE id = $1::uuid`, [id])
        return existing.rows.length > 0 ? 'not_published' : 'missing'
      },
      async withdrawWebinarsForContent(contentId, atIso) {
        const result = await client.query(
          `UPDATE webinars
           SET status = 'withdrawn', withdrawn_at = $2::timestamptz, updated_at = $2::timestamptz
           WHERE content_id = $1::uuid AND status IN ('pending', 'published')
           RETURNING id`,
          [contentId, atIso],
        )
        return result.rows.length
      },
    }
  }

  return {
    async transaction(fn) {
      return withClient(async (client) => {
        await client.query('BEGIN')
        try {
          const result = await fn(tx(client))
          await client.query('COMMIT')
          return result
        } catch (error) {
          await client.query('ROLLBACK')
          throw error
        }
      })
    },
    async listPublished(productId) {
      return withClient(async (client) => {
        const result = await client.query<{
          id: string
          product_id: string
          author_name: string | null
          body: string
          media: unknown
        }>(
          `SELECT id::text, product_id, author_name, body, media
           FROM product_reviews
           WHERE status = 'published'
             AND withdrawn_at IS NULL
             AND ($1::text IS NULL OR product_id = $1)
           ORDER BY received_at ASC, id ASC
           LIMIT 100`,
          [productId],
        )
        return result.rows.map(
          (row): PublicReview => ({
            id: row.id,
            productId: row.product_id,
            author: row.author_name,
            text: row.body,
            media: publicMediaFromJson(row.media),
          }),
        )
      })
    },

    async listPublicWebinars() {
      return withClient(async (client) => {
        const result = await client.query<WebinarRow>(
          `SELECT ${WEBINAR_COLUMNS}
           FROM webinars
           WHERE status = 'published' AND withdrawn_at IS NULL
           ORDER BY COALESCE(event_date::timestamptz, published_at) DESC, id ASC
           LIMIT 100`,
        )
        return result.rows.map(webinarFrom).map(toPublicWebinar).filter((item) => item != null)
      })
    },
    async getGroupContent(id) {
      return withClient(async (client) => {
        const result = await client.query<{
          id: string
          chat_id: string
          message_mid: string
          received_at: string
          kind: ContentKind
          body_text: string | null
          public_text: string | null
          attachments: unknown
          status: ContentStatus
          published_review_id: string | null
        }>(
          `SELECT id::text, chat_id::text, message_mid, received_at::text, kind,
                  body_text, public_text, attachments, status, published_review_id::text
           FROM incoming_content
           WHERE id = $1::uuid`,
          [id],
        )
        const row = result.rows[0]
        return row ? contentFrom(row) : null
      })
    },

    async updateGroupAttachments(id, attachments) {
      await withClient(async (client) => {
        await client.query(`UPDATE incoming_content SET attachments = $2::jsonb WHERE id = $1::uuid`, [
          id,
          JSON.stringify(attachments),
        ])
      })
    },
    async listPendingOutbox(key) {
      return withClient(async (client) => {
        const result = await client.query<{
          id: string
          kind: 'message' | 'callback_answer'
          chat_id: string | null
          user_id: string | null
          callback_id: string | null
          body_text: string | null
          attachments: unknown
          notification: string | null
        }>(
          `SELECT id::text, kind, chat_id::text, user_id::text, callback_id, body_text, attachments, notification
           FROM review_outbox
           WHERE idempotency_key = $1
           ORDER BY position ASC`,
          [key],
        )
        return result.rows.map(
          (row): OutboxJob => ({
            id: row.id,
            kind: row.kind,
            chatId: textOrNull(row.chat_id),
            userId: textOrNull(row.user_id),
            callbackId: textOrNull(row.callback_id),
            text: textOrNull(row.body_text),
            attachments: asKeyboard(row.attachments),
            notification: textOrNull(row.notification),
          }),
        )
      })
    },
    async claimSend(id, now) {
      return withClient(async (client) => {
        const existing = await client.query<{ sending_at: string | null }>(
          `SELECT sending_at::text FROM review_outbox WHERE id = $1::uuid`,
          [id],
        )
        if (existing.rows.length === 0) return 'missing' as const
        const result = await client.query(
          `UPDATE review_outbox
           SET sending_at = $2::timestamptz
           WHERE id = $1::uuid
             AND (sending_at IS NULL OR sending_at < $2::timestamptz - interval '20 seconds')
           RETURNING id`,
          [id, now.toISOString()],
        )
        return result.rows.length > 0 ? ('claimed' as const) : ('busy' as const)
      })
    },
    async deleteOutbox(id) {
      await withClient((client) => client.query(`DELETE FROM review_outbox WHERE id = $1::uuid`, [id]))
    },
    async releaseOutbox(id) {
      await withClient((client) => client.query(`UPDATE review_outbox SET sending_at = NULL WHERE id = $1::uuid`, [id]))
    },
  }
}
