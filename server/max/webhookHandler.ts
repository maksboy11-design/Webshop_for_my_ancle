import { attachmentsForStorage, attachmentsNeedPersist } from './attachments'
import { classifyMessage } from './classify'
import { jsonResponse, readLimitedJson } from './http'
import type { Log } from './logger'
import { deliverOutbox } from './deliver'
import { IntakeDeferred, isGroupTraffic, planGroupUpdate } from './groupIntake'
import type { MaxClient } from './maxClient'
import { ensureContentMediaPersisted, persistUpdateAttachments } from './mediaPersist'
import { planReviewEvent } from './reviewFlow'
import { secretsMatch } from './secret'
import type { ReviewStore } from './store'
import { reviewId } from './text'
import { isPrivateDialog, parseUpdate, type SupportedUpdate } from './update'

function shouldDeferGroup(
  update: SupportedUpdate,
  deps: HandlerDeps,
): update is Extract<SupportedUpdate, { type: 'message_created' }> & { chatId: string } {
  return (
    update.type === 'message_created' &&
    update.chatType === 'chat' &&
    update.chatId != null &&
    deps.allowedChatsConfigured &&
    deps.allowedChatIds.has(update.chatId)
  )
}

/** Скачивание медиа в Blob не должно задерживать подтверждение вебхука (MAX ждёт 200 до 30 с). */
const MEDIA_INTAKE_BUDGET_MS = 12_000
/** Отправка DM модераторам после записи группы: вместе с медиа укладываемся в 30 с вебхука. */
const GROUP_NOTIFY_BUDGET_MS = 10_000

function errorClassOf(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown'
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && /^[A-Za-z0-9_]{1,16}$/.test(code) ? `${error.name}:${code}` : error.name
}

async function withBudget<T>(work: Promise<T>, fallback: T, ms: number): Promise<{ value: T; timedOut: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<{ value: T; timedOut: boolean }>((resolve) => {
    timer = setTimeout(() => resolve({ value: fallback, timedOut: true }), ms)
  })
  try {
    return await Promise.race([work.then((value) => ({ value, timedOut: false })), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function approveContentId(update: SupportedUpdate): string | null {
  if (update.type !== 'message_created' || update.text == null) return null
  const match = /^\/review_approve(?:@\S+)?\s+(\S+)/u.exec(update.text.trim())
  if (!match) return null
  return reviewId(match[1] ?? null)
}

export interface HandlerDeps {
  secret: string | null
  secretConfigured: boolean
  moderators: ReadonlySet<string>
  moderatorsConfigured: boolean
  store: ReviewStore | null
  max: MaxClient | null
  now: () => Date
  sleep: (ms: number) => Promise<void>
  log: Log
  rateLimit: { max: number; windowMs: number }
  groupRateLimit: { max: number; windowMs: number }
  allowedChatIds: ReadonlySet<string>
  allowedChatsConfigured: boolean
  sessionTtlMs: number
  deliveryBudgetMs: number
  blobToken: string | null
}

export async function handleMaxWebhook(request: Request, deps: HandlerDeps): Promise<Response> {
  if (request.method !== 'POST') return jsonResponse(405, { error: 'method_not_allowed' }, { allow: 'POST' })
  if (!deps.secretConfigured || !deps.secret || !secretsMatch(deps.secret, request.headers.get('x-max-bot-api-secret'))) {
    return jsonResponse(401, { error: 'unauthorized' })
  }
  const body = await readLimitedJson(request)
  if (!body.ok) return jsonResponse(body.status, { error: body.status === 413 ? 'payload_too_large' : 'bad_request' })
  const parsed = parseUpdate(body.value)
  if (parsed.action === 'reject') {
    deps.log.info('invalid_update')
    return jsonResponse(400, { error: 'bad_request' })
  }
  if (parsed.action === 'ignore') return jsonResponse(200, { ok: true })
  if (!deps.store || !deps.max) {
    deps.log.error('storage_failed')
    return jsonResponse(503, { error: 'unavailable' })
  }
  const update = parsed.update
  const store = deps.store
  const max = deps.max
  const mediaDeps = { blobToken: deps.blobToken, max, store, log: deps.log }

  if (isGroupTraffic(update)) {
    const allowedChat = update.chatId != null && deps.allowedChatsConfigured && deps.allowedChatIds.has(update.chatId)
    let duplicate = false
    try {
      if (
        (update.type === 'message_created' || update.type === 'message_edited') &&
        update.chatId != null &&
        allowedChat &&
        attachmentsNeedPersist(update.attachments)
      ) {
        const persisted = await withBudget(
          persistUpdateAttachments(update.chatId, update.messageMid, update.attachments, mediaDeps),
          attachmentsForStorage(update.attachments),
          MEDIA_INTAKE_BUDGET_MS,
        )
        if (persisted.timedOut) deps.log.info('media_budget_exceeded')
        update.attachments = persisted.value
      }
      await store.transaction(async (tx) => {
        if (shouldDeferGroup(update, deps)) {
          const existing = await tx.findGroupMessage(update.chatId, update.messageMid)
          if (!existing) {
            const since = new Date(deps.now().getTime() - deps.groupRateLimit.windowMs).toISOString()
            const count = await tx.countGroupMessages(update.chatId, since)
            if (count >= deps.groupRateLimit.max) throw new IntakeDeferred()
          }
        }
        const claim = await tx.claim(update.key, update.type)
        if (claim === 'duplicate') {
          duplicate = true
          return
        }
        await planGroupUpdate(update, tx, deps)
      })
    } catch (error) {
      if (error instanceof IntakeDeferred) {
        deps.log.info('group_deferred', { updateType: update.type })
        return jsonResponse(503, { error: 'unavailable' })
      }
      deps.log.error('storage_failed', { updateType: update.type, errorClass: errorClassOf(error) })
      return jsonResponse(503, { error: 'unavailable' })
    }
    if (allowedChat && (update.type === 'message_created' || update.type === 'message_edited')) {
      try {
        const pending = await store.listPendingOutbox(update.key)
        if (pending.length > 0) {
          const delivery = await deliverOutbox(pending, store, max, deps.log, deps.now, deps.sleep, Math.min(deps.deliveryBudgetMs, GROUP_NOTIFY_BUDGET_MS))
          if (delivery === 'retry') return jsonResponse(503, { error: 'unavailable' })
        }
      } catch {
        deps.log.error('storage_failed', { updateType: update.type })
        return jsonResponse(503, { error: 'unavailable' })
      }
    }
    const text = update.type === 'message_created' || update.type === 'message_edited' ? update.text : null
    const attachments = update.type === 'message_created' || update.type === 'message_edited' ? update.attachments : []
    deps.log.info('group_intake', {
      updateType: update.type,
      allowed: allowedChat,
      chatType: 'chatType' in update && update.chatType ? update.chatType : 'unknown',
      chatSign: update.chatId == null ? 'none' : update.chatId.startsWith('-') ? 'negative' : 'positive',
      duplicate,
      kind: allowedChat && (update.type === 'message_created' || update.type === 'message_edited') ? classifyMessage(text, attachments).kind : undefined,
      attachments: attachments.length,
    })
    return jsonResponse(200, { ok: true })
  }
  if (update.type === 'message_edited') {
    try {
      await store.transaction(async (tx) => {
        await tx.claim(update.key, update.type)
      })
    } catch {
      deps.log.error('storage_failed')
      return jsonResponse(503, { error: 'unavailable' })
    }
    return jsonResponse(200, { ok: true })
  }
  try {
    const contentId = approveContentId(update)
    if (contentId) {
      await ensureContentMediaPersisted(contentId, mediaDeps)
    }
    await store.transaction(async (tx) => {
      const claim = await tx.claim(update.key, update.type)
      if (claim === 'duplicate') return
      if (!isPrivateDialog(update)) return
      const nowIso = deps.now().toISOString()
      await tx.pruneActions(new Date(deps.now().getTime() - 24 * 60 * 60 * 1000).toISOString())
      const since = new Date(deps.now().getTime() - deps.rateLimit.windowMs).toISOString()
      const count = await tx.countActions(update.userId, since)
      if (count >= deps.rateLimit.max) {
        await tx.recordAction(update.userId, nowIso)
        const callbackId = update.type === 'message_callback' ? update.callbackId : null
        await tx.enqueue(update.key, [
          {
            kind: callbackId ? 'callback_answer' : 'message',
            chatId: update.chatId,
            userId: update.userId,
            callbackId,
            text: 'Слишком много сообщений. Подождите немного и отправьте /review снова.',
            attachments: null,
            notification: callbackId ? 'Принято' : null,
          },
        ])
        return
      }
      await tx.recordAction(update.userId, nowIso)
      const jobs = await planReviewEvent(update, tx, deps)
      await tx.enqueue(update.key, jobs)
    })
  } catch {
    deps.log.error('storage_failed')
    return jsonResponse(503, { error: 'unavailable' })
  }
  try {
    const pending = await store.listPendingOutbox(update.key)
    const delivery = await deliverOutbox(pending, store, max, deps.log, deps.now, deps.sleep, deps.deliveryBudgetMs)
    if (delivery === 'retry') return jsonResponse(503, { error: 'unavailable' })
  } catch {
    deps.log.error('storage_failed')
    return jsonResponse(503, { error: 'unavailable' })
  }
  return jsonResponse(200, { ok: true })
}
