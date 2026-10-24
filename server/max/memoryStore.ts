import { randomUUID } from 'node:crypto'
import type { NewJob, NewReview, OutboxJob, PendingReview, PublicReview, ReviewStore, SessionRecord, StoreTx } from './store'

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
}

interface MemoryState {
  receipts: Map<string, string>
  sessions: Map<string, SessionRecord>
  reviews: Map<string, StoredReview>
  outbox: Map<string, OutboxRow>
  actions: { userId: string; at: string }[]
}

function cloneState(state: MemoryState): MemoryState {
  return {
    receipts: new Map(state.receipts),
    sessions: new Map([...state.sessions].map(([key, value]) => [key, { ...value }])),
    reviews: new Map([...state.reviews].map(([key, value]) => [key, { ...value }])),
    outbox: new Map([...state.outbox].map(([key, value]) => [key, { ...value }])),
    actions: state.actions.map((item) => ({ ...item })),
  }
}

function toPublic(review: StoredReview): PublicReview {
  return { id: review.id, productId: review.productId, author: review.author, text: review.text }
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
          .filter((item) => item.status === 'published' && (productId === null || item.productId === productId))
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
    releaseOutbox(id) {
      return enqueue(async () => {
        const row = state.outbox.get(id)
        if (!row) return
        state.outbox.set(id, { ...row, sendingAt: null })
      })
    },
  }
}
