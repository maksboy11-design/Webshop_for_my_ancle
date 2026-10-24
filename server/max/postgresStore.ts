import { randomUUID } from 'node:crypto'
import type { StoredAttachment } from './attachments'
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
} from './store'

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
      async listPendingGroup(limit) {
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
           WHERE status = 'pending' AND kind = 'review'
           ORDER BY received_at ASC, id ASC
           LIMIT $1`,
          [limit],
        )
        return result.rows.map(contentFrom)
      },
      async publishGroupReview(id, productId, moderatorUserId, atIso) {
        const existing = await client.query<{
          status: ContentStatus
          kind: ContentKind
          public_text: string | null
          received_at: string
        }>(
          `SELECT status, kind, public_text, received_at::text
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
        await client.query(
          `INSERT INTO product_reviews (
             id, product_id, body, author_name, status, source,
             received_at, consent_at, decided_at, moderator_user_id, idempotency_key, sender_user_id
           ) VALUES (
             $1::uuid, $2, $3, NULL, 'published', 'MAX',
             $4::timestamptz, $4::timestamptz, $5::timestamptz, $6::bigint, $7, NULL
           )`,
          [reviewId, productId, row.public_text, row.received_at, atIso, moderatorUserId, `group-review:${reviewId}`],
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
        }>(
          `SELECT id::text, product_id, author_name, body
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
          }),
        )
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
