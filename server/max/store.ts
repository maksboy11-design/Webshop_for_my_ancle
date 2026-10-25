import type { PublicReviewMedia, StoredAttachment } from './attachments'
import type { ContentKind } from './classify'
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
  senderUserId: string | null
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
  media: PublicReviewMedia[]
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

export type ContentStatus = 'pending' | 'published' | 'rejected' | 'removed' | 'empty'

export interface IncomingContent {
  id: string
  chatId: string
  messageMid: string
  receivedAt: string
  kind: ContentKind
  text: string | null
  publicText: string | null
  attachments: StoredAttachment[]
  status: ContentStatus
  publishedReviewId: string | null
}

export interface NewContent {
  id: string
  chatId: string
  messageMid: string
  receivedAt: string
  kind: ContentKind
  text: string | null
  publicText: string | null
  attachments: StoredAttachment[]
  status: ContentStatus
  idempotencyKey: string
}

export type GroupPublishResult = 'published' | 'missing' | 'not_pending' | 'needs_text' | 'too_long'

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
  findGroupMessage(chatId: string, messageMid: string): Promise<IncomingContent | null>
  countGroupMessages(chatId: string, sinceIso: string): Promise<number>
  insertGroupMessage(content: NewContent): Promise<'created' | 'duplicate'>
  replaceGroupMessage(content: NewContent, editedAt: string): Promise<'updated' | 'missing' | 'removed'>
  removeGroupMessage(chatId: string, messageMid: string): Promise<'removed' | 'missing'>
  /** 'review' — только записи с маркером «Отзыв»; 'other' — прочий ожидающий контент группы (только просмотр). */
  listPendingGroup(limit: number, scope?: 'review' | 'other'): Promise<IncomingContent[]>
  publishGroupReview(
    id: string,
    productId: string,
    moderatorUserId: string,
    atIso: string,
  ): Promise<GroupPublishResult>
  rejectGroup(id: string): Promise<'rejected' | 'missing' | 'not_pending'>
}

export interface ReviewStore {
  transaction<T>(fn: (tx: StoreTx) => Promise<T>): Promise<T>
  listPublished(productId: string | null): Promise<PublicReview[]>
  listPendingOutbox(key: string): Promise<OutboxJob[]>
  claimSend(id: string, now: Date): Promise<'claimed' | 'busy' | 'missing'>
  deleteOutbox(id: string): Promise<void>
  releaseOutbox(id: string): Promise<void>
  getGroupContent(id: string): Promise<IncomingContent | null>
  updateGroupAttachments(id: string, attachments: StoredAttachment[]): Promise<void>
}
