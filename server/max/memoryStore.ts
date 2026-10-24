import { randomUUID } from 'node:crypto'
import { publicMediaOf } from './attachments'
import { codePointLength, REVIEW_TEXT_MAX } from './text'
import type {
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

interface OutboxRow extends NewJob {
  id: string
  key: string
  position: number
  sendingAt: number | null
}

interface StoredReview extends NewReview {
  status: 'pending' | 'published' | 'rejected'
  decidedAt: string | null
  moderatorUserId: string | null
  withdrawnAt: string | null
  media: PublicReview['media']
}

interface ContentRow extends IncomingContent {
  idempotencyKey: string
}

interface MemoryState {
  receipts: Map<string, string>
  sessions: Map<string, SessionRecord>
  reviews: Map<string, StoredReview>
  content: Map<string, ContentRow>
  outbox: Map<string, OutboxRow>
  actions: { userId: string; at: string }[]
}

function cloneState(state: MemoryState): MemoryState {
  return {
    receipts: new Map(state.receipts),
    sessions: new Map([...state.sessions].map(([key, value]) => [key, { ...value }])),
    reviews: new Map([...state.reviews].map(([key, value]) => [key, { ...value }])),
    content: new Map([...state.content].map(([key, value]) => [key, { ...value, attachments: value.attachments.map((item) => ({ ...item })) }])),
    outbox: new Map([...state.outbox].map(([key, value]) => [key, { ...value }])),
    actions: state.actions.map((item) => ({ ...item })),
  }
}

function toPublic(review: StoredReview): PublicReview {
  return {
    id: review.id,
    productId: review.productId,
    author: review.author,
    text: review.text,
    media: review.media.map((item) => ({ ...item })),
  }
}

function toPending(review: StoredReview): PendingReview {
  return {
    id: review.id,
    productId: review.productId,
    text: review.text,
    author: review.author,
    receivedAt: review.receivedAt,
  }
}

function toJob(row: OutboxRow): OutboxJob {
  return {
    id: row.id,
    kind: row.kind,
    chatId: row.chatId,
    userId: row.userId,
    callbackId: row.callbackId,
    text: row.text,
    attachments: row.attachments,
    notification: row.notification,
  }
}

function createTx(working: MemoryState): StoreTx {
  return {
    async claim(key, updateType) {
      if (working.receipts.has(key)) return 'duplicate'
      working.receipts.set(key, updateType)
      return 'new'
    },
    async getSession(userId, nowIso) {
      const row = working.sessions.get(userId)
      if (!row) return { status: 'none' }
      if (row.expiresAt <= nowIso) {
        working.sessions.delete(userId)
        return { status: 'expired' }
      }
      return { status: 'active', session: { ...row } }
    },
    async putSession(userId, session) {
      working.sessions.set(userId, { ...session })
    },
    async deleteSession(userId) {
      working.sessions.delete(userId)
    },
    async insertPending(review) {
      if (!review.consentAt) throw new Error('consent_required')
      if ([...working.reviews.values()].some((item) => item.idempotencyKey === review.idempotencyKey)) return
      working.reviews.set(review.id, {
        ...review,
        status: 'pending',
        decidedAt: null,
        moderatorUserId: null,
        withdrawnAt: null,
        media: [],
      })
    },
    async listPending(limit) {
      return [...working.reviews.values()]
        .filter((item) => item.status === 'pending')
        .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.id.localeCompare(b.id))
        .slice(0, limit)
        .map(toPending)
    },
    async countPending() {
      return [...working.reviews.values()].filter((item) => item.status === 'pending').length
    },
    async decide(id, status, moderatorUserId, atIso) {
      const row = working.reviews.get(id)
      if (!row) return 'missing'
      if (row.status !== 'pending') return 'not_pending'
      working.reviews.set(id, { ...row, status, moderatorUserId, decidedAt: atIso })
      return 'updated'
    },
    async findGroupMessage(chatId, messageMid) {
      return [...working.content.values()].find((item) => item.chatId === chatId && item.messageMid === messageMid) ?? null
    },
    async countGroupMessages(chatId, sinceIso) {
      return [...working.content.values()].filter((item) => item.chatId === chatId && item.receivedAt >= sinceIso).length
    },
    async insertGroupMessage(content) {
      if ([...working.content.values()].some((item) => item.chatId === content.chatId && item.messageMid === content.messageMid)) {
        return 'duplicate'
      }
      working.content.set(content.id, { ...content, publishedReviewId: null, attachments: content.attachments.map((item) => ({ ...item })) })
      return 'created'
    },
    async replaceGroupMessage(content, editedAt) {
      const current = [...working.content.values()].find((item) => item.chatId === content.chatId && item.messageMid === content.messageMid)
      if (!current) return 'missing'
      if (current.status === 'removed') return 'removed'
      if (current.publishedReviewId) {
        const review = working.reviews.get(current.publishedReviewId)
        if (review) working.reviews.set(review.id, { ...review, withdrawnAt: editedAt })
      }
      working.content.set(current.id, {
        ...current,
        kind: content.kind,
        text: content.text,
        publicText: content.publicText,
        attachments: content.attachments.map((item) => ({ ...item })),
        status: content.status === 'empty' ? 'empty' : 'pending',
        publishedReviewId: null,
        receivedAt: current.receivedAt,
      })
      return 'updated'
    },
    async removeGroupMessage(chatId, messageMid) {
      const current = [...working.content.values()].find((item) => item.chatId === chatId && item.messageMid === messageMid)
      if (!current) return 'missing'
      if (current.publishedReviewId) {
        const review = working.reviews.get(current.publishedReviewId)
        if (review && review.withdrawnAt == null) working.reviews.set(review.id, { ...review, withdrawnAt: current.receivedAt })
      }
      working.content.set(current.id, { ...current, status: 'removed', publishedReviewId: current.publishedReviewId })
      return 'removed'
    },
    async listPendingGroup(limit) {
      return [...working.content.values()]
        .filter((item) => item.status === 'pending' && item.kind === 'review')
        .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.id.localeCompare(b.id))
        .slice(0, limit)
        .map((item) => ({ ...item, attachments: item.attachments.map((attachment) => ({ ...attachment })) }))
    },
    async publishGroupReview(id, productId, moderatorUserId, atIso) {
      const current = working.content.get(id)
      if (!current) return 'missing'
      if (current.status !== 'pending' || current.kind !== 'review') return 'not_pending'
      if (!current.publicText) return 'needs_text'
      if (codePointLength(current.publicText) > REVIEW_TEXT_MAX) return 'too_long'
      const reviewId = randomUUID()
      working.reviews.set(reviewId, {
        id: reviewId,
        productId,
        text: current.publicText,
        author: null,
        receivedAt: current.receivedAt,
        consentAt: current.receivedAt,
        idempotencyKey: `group-review:${reviewId}`,
        senderUserId: null,
        status: 'published',
        decidedAt: atIso,
        moderatorUserId,
        withdrawnAt: null,
        media: publicMediaOf(current.attachments),
      })
      working.content.set(id, { ...current, status: 'published', publishedReviewId: reviewId })
      return 'published'
    },
    async rejectGroup(id) {
      const current = working.content.get(id)
      if (!current) return 'missing'
      if (current.status !== 'pending') return 'not_pending'
      working.content.set(id, { ...current, status: 'rejected' })
      return 'rejected'
    },
    async enqueue(key, jobs) {
      jobs.forEach((job, position) => {
        const id = randomUUID()
        working.outbox.set(id, { ...job, id, key, position, sendingAt: null })
      })
    },
    async countActions(userId, sinceIso) {
      return working.actions.filter((item) => item.userId === userId && item.at >= sinceIso).length
    },
    async recordAction(userId, atIso) {
      working.actions.push({ userId, at: atIso })
    },
    async pruneActions(beforeIso) {
      working.actions = working.actions.filter((item) => item.at >= beforeIso)
    },
  }
}

export function createMemoryStore(): ReviewStore {
  let state: MemoryState = {
    receipts: new Map(),
    sessions: new Map(),
    reviews: new Map(),
    content: new Map(),
    outbox: new Map(),
    actions: [],
  }
  let queue: Promise<unknown> = Promise.resolve()

  function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = queue.then(fn, fn)
    queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  return {
    transaction(fn) {
      return enqueue(async () => {
        const working = cloneState(state)
        const result = await fn(createTx(working))
        state = working
        return result
      })
    },
    listPublished(productId) {
      return enqueue(async () =>
        [...state.reviews.values()]
          .filter((item) => item.status === 'published' && item.withdrawnAt == null && (productId === null || item.productId === productId))
          .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.id.localeCompare(b.id))
          .slice(0, 100)
          .map(toPublic),
      )
    },
    listPendingOutbox(key) {
      return enqueue(async () =>
        [...state.outbox.values()]
          .filter((item) => item.key === key)
          .sort((a, b) => a.position - b.position)
          .map(toJob),
      )
    },
    claimSend(id, now) {
      return enqueue(async () => {
        const row = state.outbox.get(id)
        if (!row) return 'missing' as const
        if (row.sendingAt !== null && now.getTime() - row.sendingAt < 20_000) return 'busy' as const
        state.outbox.set(id, { ...row, sendingAt: now.getTime() })
        return 'claimed' as const
      })
    },
    deleteOutbox(id) {
      return enqueue(async () => {
        state.outbox.delete(id)
      })
    },
    getGroupContent(id) {
      return enqueue(async () => {
        const row = state.content.get(id)
        if (!row) return null
        return { ...row, attachments: row.attachments.map((item) => ({ ...item })) }
      })
    },
    updateGroupAttachments(id, attachments) {
      return enqueue(async () => {
        const row = state.content.get(id)
        if (!row) return
        state.content.set(id, { ...row, attachments: attachments.map((item) => ({ ...item, sourceUrl: null })) })
      })
    },
    releaseOutbox(id) {
      return enqueue(async () => {
        const row = state.outbox.get(id)
        if (!row) return
        state.outbox.set(id, { ...row, sendingAt: null })
      })
    },
  }
}
