import type { InlineKeyboard } from './maxClient'

export type ReviewStatus = 'pending' | 'published' | 'rejected'

export interface SessionRecord {
  step: 'choose_product' | 'enter_text' | 'enter_name' | 'consent'
  productId: string | null
  draftText: string | null
  authorName: string | null
  expiresAt: string
}

export interface NewReview {
  id: string
  productId: string
  text: string
  author: string | null
  receivedAt: string
  consentAt: string
  idempotencyKey: string
  senderUserId: string
}

export interface PendingReview {
  id: string
  productId: string
  text: string
  author: string | null
  receivedAt: string
}

export interface PublicReview {
  id: string
  productId: string
  author: string | null
  text: string
}

export interface NewJob {
  kind: 'message' | 'callback_answer'
  chatId: string | null
  userId: string | null
  callbackId: string | null
  text: string | null
  attachments: InlineKeyboard | null
  notification: string | null
}

export interface OutboxJob extends NewJob {
  id: string
}

export type SessionLookup =
  | { status: 'none' }
  | { status: 'expired' }
  | { status: 'active'; session: SessionRecord }

export interface StoreTx {
  claim(key: string, updateType: string): Promise<'new' | 'duplicate'>
  getSession(userId: string, nowIso: string): Promise<SessionLookup>
  putSession(userId: string, session: SessionRecord, nowIso: string): Promise<void>
  deleteSession(userId: string): Promise<void>
  insertPending(review: NewReview): Promise<void>
  listPending(limit: number): Promise<PendingReview[]>
  countPending(): Promise<number>
  decide(
    id: string,
    status: 'published' | 'rejected',
    moderatorUserId: string,
    atIso: string,
  ): Promise<'updated' | 'missing' | 'not_pending'>
  enqueue(key: string, jobs: NewJob[]): Promise<void>
  countActions(userId: string, sinceIso: string): Promise<number>
  recordAction(userId: string, atIso: string): Promise<void>
  pruneActions(beforeIso: string): Promise<void>
}

export interface ReviewStore {
  transaction<T>(fn: (tx: StoreTx) => Promise<T>): Promise<T>
  listPublished(productId: string | null): Promise<PublicReview[]>
  listPendingOutbox(key: string): Promise<OutboxJob[]>
  claimSend(id: string, now: Date): Promise<'claimed' | 'busy' | 'missing'>
  deleteOutbox(id: string): Promise<void>
  releaseOutbox(id: string): Promise<void>
}
