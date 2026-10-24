import { jsonResponse, readLimitedJson } from './http'
import type { Log } from './logger'
import { deliverOutbox } from './deliver'
import type { MaxClient } from './maxClient'
import { planReviewEvent } from './reviewFlow'
import { secretsMatch } from './secret'
import type { ReviewStore } from './store'
import { isPrivateDialog, parseUpdate } from './update'

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
  sessionTtlMs: number
  deliveryBudgetMs: number
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
  try {
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
