import { randomUUID } from 'node:crypto'
import { attachmentsForStorage } from './attachments'
import { classifyMessage } from './classify'
import type { HandlerDeps } from './webhookHandler'
import { moderatorNotificationJobs } from './moderatorNotify'
import type { IncomingContent, NewContent, StoreTx } from './store'
import type { SupportedUpdate } from './update'

export class IntakeDeferred extends Error {
  constructor() {
    super('intake_deferred')
    this.name = 'IntakeDeferred'
  }
}

export function isGroupTraffic(update: SupportedUpdate): boolean {
  if (update.type === 'message_removed') return true
  return (update.type === 'message_created' || update.type === 'message_edited') && update.chatType === 'chat'
}

function allowed(chatId: string | null, deps: HandlerDeps): chatId is string {
  return chatId != null && deps.allowedChatsConfigured && deps.allowedChatIds.has(chatId)
}

function contentOf(
  update: Extract<SupportedUpdate, { type: 'message_created' | 'message_edited' }>,
  chatId: string,
  receivedAt: string,
): NewContent {
  const classified = classifyMessage(update.text, update.attachments)
  return {
    id: randomUUID(),
    chatId,
    messageMid: update.messageMid,
    receivedAt,
    kind: classified.kind,
    text: classified.text,
    publicText: classified.publicText,
    attachments: attachmentsForStorage(update.attachments),
    status: classified.kind === 'empty' ? 'empty' : 'pending',
    idempotencyKey: `group:${chatId}:${update.messageMid}`,
  }
}

function isPendingReview(row: IncomingContent | null): row is IncomingContent {
  return row != null && row.kind === 'review' && row.status === 'pending'
}

/** Ставит в очередь личное сообщение каждому модератору. Отправка идёт после коммита (deliverOutbox). */
async function notifyModerators(row: IncomingContent, key: string, tx: StoreTx, deps: HandlerDeps): Promise<void> {
  if (!deps.moderatorsConfigured || deps.moderators.size === 0) {
    deps.log.info('moderator_notify_skipped', { configured: deps.moderatorsConfigured, notified: 0 })
    return
  }
  const jobs = moderatorNotificationJobs(row, deps.moderators)
  await tx.enqueue(key, jobs)
  deps.log.info('moderator_notify_queued', { notified: jobs.length })
}

/** Сохраняет сообщение разрешённой группы. Новый отзыв с маркером ставит DM модераторам в outbox. */
export async function planGroupUpdate(update: SupportedUpdate, tx: StoreTx, deps: HandlerDeps): Promise<void> {
  const chatId = update.chatId
  if (!allowed(chatId, deps)) {
    deps.log.info('group_rejected', { configured: deps.allowedChatsConfigured })
    return
  }
  if (update.type === 'message_removed') {
    await tx.removeGroupMessage(chatId, update.messageMid)
    return
  }
  if (update.type !== 'message_created' && update.type !== 'message_edited') return
  const content = contentOf(update, chatId, deps.now().toISOString())
  const fresh: IncomingContent = { ...content, publishedReviewId: null }
  if (update.type === 'message_edited') {
    const before = await tx.findGroupMessage(chatId, update.messageMid)
    const edited = await tx.replaceGroupMessage(content, content.receivedAt)
    if (edited === 'missing') {
      const inserted = await tx.insertGroupMessage(content)
      if (inserted === 'created' && isPendingReview(fresh)) {
        await notifyModerators(fresh, update.key, tx, deps)
      }
      return
    }
    // Правка уже известного отзыва: повторно уведомляем, только если он стал отзывом, которого модератор ещё не видел
    // (был не отзывом либо уже опубликован/отклонён и вернулся в очередь). Правка ожидающего отзыва молча обновляет запись.
    if (edited === 'updated' && !isPendingReview(before)) {
      const after = await tx.findGroupMessage(chatId, update.messageMid)
      if (isPendingReview(after)) await notifyModerators(after, update.key, tx, deps)
    }
    return
  }
  const existing = await tx.findGroupMessage(chatId, update.messageMid)
  if (existing) return
  const inserted = await tx.insertGroupMessage(content)
  deps.log.info('group_stored', { updateType: content.kind })
  if (inserted === 'created' && isPendingReview(fresh)) {
    await notifyModerators(fresh, update.key, tx, deps)
  }
}
