import { randomUUID } from 'node:crypto'
import type { InlineKeyboard } from './maxClient'
import type {
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
