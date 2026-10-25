import { MaxPermanentError, MaxTemporaryError, type InlineKeyboard, type MaxClient } from './maxClient'
import type { Log } from './logger'
import type { OutboxJob, ReviewStore } from './store'

export async function deliverOutbox(
  jobs: readonly OutboxJob[],
  store: ReviewStore,
  max: MaxClient,
  log: Log,
  now: () => Date,
  sleep: (ms: number) => Promise<void>,
  budgetMs: number,
): Promise<'ok' | 'retry'> {
  const started = Date.now()
  let sent = 0
  for (const job of jobs) {
    if (Date.now() - started + 3000 > budgetMs) return 'retry'
    const claim = await store.claimSend(job.id, now())
    if (claim === 'missing') continue
    if (claim === 'busy') return 'retry'
    if (sent > 0) await sleep(500)
    try {
      if (job.kind === 'callback_answer' && job.callbackId) {
        await max.answerCallback({
          callbackId: job.callbackId,
          text: job.text,
          attachments: job.attachments,
          notification: job.notification,
        })
      } else {
        try {
          await max.sendMessage({
            chatId: job.chatId,
            userId: job.userId,
            text: job.text ?? '',
            attachments: job.attachments,
          })
        } catch (error) {
          const fallback = job.attachments?.fallbackText
          if (!(error instanceof MaxPermanentError) || !job.attachments?.media?.length || !fallback) throw error
          log.error('max_media_fallback', { status: error.status })
          const keyboard: InlineKeyboard = { type: 'inline_keyboard', payload: job.attachments.payload }
          await max.sendMessage({ chatId: job.chatId, userId: job.userId, text: fallback, attachments: keyboard })
        }
      }
      await store.deleteOutbox(job.id)
      sent += 1
    } catch (error) {
      const status = error instanceof MaxTemporaryError || error instanceof MaxPermanentError ? error.status : 0
      log.error('max_delivery_failed', { status })
      if (error instanceof MaxTemporaryError) {
        await store.releaseOutbox(job.id)
        return 'retry'
      }
      await store.deleteOutbox(job.id)
    }
  }
  return 'ok'
}
