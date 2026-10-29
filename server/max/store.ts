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

export interface PublishedReviewSummary {
  id: string
  productId: string
  author: string | null
  text: string
  mediaCount: number
  photosCount: number
  videosCount: number
  publishedAt: string | null
}

export interface PublishedReviewSearchQuery {
  q: string
  photos: number | null
  videos: number | null
  limit: number
  offset: number
}

export interface PublishedReviewAdminItem {
  id: string
  productId: string
  productName: string
  author: string | null
  text: string
  textPreview: string
  photosCount: number
  videosCount: number
  mediaCount: number
  media: PublicReview['media']
  publishedAt: string | null
}

export type WithdrawResult = 'withdrawn' | 'missing' | 'not_published'

/** Правка опубликованного отзыва модератором. undefined = поле не меняется. */
export interface ReviewEditPatch {
  text?: string
  author?: string | null
  productId?: string
  /** src медиа, которые нужно отвязать от отзыва (файлы в Blob не удаляются). */
  removeMediaSrc?: string[]
}

export type EditReviewResult = { result: 'updated'; removedMedia: number } | { result: 'missing' } | { result: 'not_published' }

export type WebinarStatus = 'pending' | 'published' | 'rejected' | 'withdrawn'
export type WebinarSourceType = 'youtube' | 'hosted'
export type WebinarMetadataStatus = 'ok' | 'not_configured' | 'not_found' | 'not_public' | 'not_embeddable' | 'api_error' | 'hosted'

export interface WebinarRecord {
  id: string
  title: string | null
  speaker: string | null
  /** YYYY-MM-DD */
  eventDate: string | null
  sourceType: WebinarSourceType
  youtubeVideoId: string | null
  startSeconds: number | null
  recordingSrc: string | null
  youtubeTitle: string | null
  youtubePublishedAt: string | null
  metadataStatus: WebinarMetadataStatus
  status: WebinarStatus
  createdAt: string
  updatedAt: string
  publishedAt: string | null
  withdrawnAt: string | null
  moderatorUserId: string | null
  contentId: string | null
  sourceChatId: string | null
  sourceMessageMid: string | null
}

export type NewWebinar = Omit<WebinarRecord, 'status' | 'publishedAt' | 'withdrawnAt' | 'moderatorUserId' | 'updatedAt'>

/**
 * created — новая запись; reopened — тот же YouTube-ролик был отклонён/снят и снова ждёт решения;
 * duplicate — ролик уже ожидает решения или опубликован (запись не меняется).
 */
export type WebinarUpsertResult =
  | { result: 'created' | 'reopened'; webinar: WebinarRecord }
  | { result: 'duplicate'; webinar: WebinarRecord }

export interface WebinarSearchQuery {
  status: WebinarStatus | null
  q: string
  limit: number
  offset: number
}

export type WebinarPublishResult = 'published' | 'missing' | 'not_pending' | 'needs_title' | 'blocked_source'

export interface PublicWebinar {
  id: string
  title: string
  speaker: string | null
  date: string | null
  sourceType: WebinarSourceType
  youtubeVideoId: string | null
  startSeconds: number | null
  recordingSrc: string | null
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
  /** Опубликованные и не снятые отзывы, новые сверху. */
  listPublishedReviews(limit: number, offset: number): Promise<PublishedReviewSummary[]>
  countPublishedReviews(): Promise<number>
  /** Поиск/фильтры для Mini App модератора: все слова q, точные photos/videos, пагинация. */
  searchPublishedReviews(query: PublishedReviewSearchQuery): Promise<{ total: number; items: PublishedReviewAdminItem[] }>
  getPublishedReview(id: string): Promise<PublishedReviewAdminItem | null>
  /** Снимает отзыв с сайта (withdrawn_at). Строка в базе остаётся. Повторный вызов — not_published. */
  withdrawReview(id: string, moderatorUserId: string, atIso: string): Promise<WithdrawResult>
  /** Правит опубликованный отзыв (текст, автор, товар, отвязка медиа). */
  editPublishedReview(id: string, patch: ReviewEditPatch): Promise<EditReviewResult>
  upsertWebinar(webinar: NewWebinar, nowIso: string): Promise<WebinarUpsertResult>
  getWebinar(id: string): Promise<WebinarRecord | null>
  findWebinarByContent(contentId: string): Promise<WebinarRecord | null>
  listWebinars(status: WebinarStatus, limit: number, offset: number): Promise<WebinarRecord[]>
  countWebinars(status: WebinarStatus): Promise<number>
  /** Обновляет поля ожидающей записи (правка сообщения, повторная проверка YouTube). */
  updatePendingWebinar(
    id: string,
    fields: Pick<WebinarRecord, 'title' | 'speaker' | 'eventDate' | 'youtubeTitle' | 'youtubePublishedAt' | 'metadataStatus'>,
    nowIso: string,
  ): Promise<'updated' | 'missing' | 'not_pending'>
  /** Повторно проверяет запись под блокировкой и публикует. */
  publishWebinar(id: string, moderatorUserId: string, atIso: string): Promise<WebinarPublishResult>
  rejectWebinar(id: string, moderatorUserId: string, atIso: string): Promise<'rejected' | 'missing' | 'not_pending'>
  withdrawWebinar(id: string, moderatorUserId: string, atIso: string): Promise<WithdrawResult>
  /**
   * Правка или удаление исходного сообщения: связанная запись (ожидающая или опубликованная) снимается
   * (status = withdrawn). Правка затем заново импортируется через upsertWebinar и снова идёт на модерацию.
   */
  withdrawWebinarsForContent(contentId: string, atIso: string): Promise<number>
  /** Админ-поиск: по всем статусам или одному, поиск по названию/спикеру/id ролика (без учёта регистра). */
  searchWebinars(query: WebinarSearchQuery): Promise<{ total: number; items: WebinarRecord[] }>
  /** Чтение с блокировкой строки (FOR UPDATE) перед правкой. */
  lockWebinar(id: string): Promise<WebinarRecord | null>
  /** Сохраняет отредактированную запись. conflict — youtube_video_id уже занят другой записью. */
  saveWebinarEdit(record: WebinarRecord): Promise<'updated' | 'conflict'>
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
  /** Только опубликованные и не снятые вебинары, для GET /api/webinars. */
  listPublicWebinars(): Promise<PublicWebinar[]>
}
