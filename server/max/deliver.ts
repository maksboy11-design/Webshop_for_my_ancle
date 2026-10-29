import { MaxPermanentError, MaxTemporaryError, type InlineKeyboard, type MaxClient } from './maxClient'
import type { Log } from './logger'
import type { OutboxJob, ReviewStore } from './store'

/** Заменяет кнопки open_app на callback-заглушку m:pl:0. null — если open_app не было. */
export function withoutOpenApp(attachments: InlineKeyboard | null): InlineKeyboard | null {
  const rows = attachments?.payload?.buttons
  if (!attachments || !rows?.some((row) => row.some((b) => b.type === 'open_app'))) return null
  return {
    ...attachments,
    payload: {
      ...attachments.payload,
      buttons: rows.map((row) =>
        row.map((b) => (b.type === 'open_app' ? { type: 'callback' as const, text: b.text, payload: 'm:pl:0' } : b)),
      ),
    },
  }
}

/** Документация MAX: web_app — username бота или ссылка на него. Подставляем, если не задан. */
export function withOpenAppWebApp(attachments: InlineKeyboard | null, username: string | null): InlineKeyboard | null {
  const rows = attachments?.payload?.buttons
  if (!attachments || !rows || !username) return attachments
  if (!rows.some((row) => row.some((b) => b.type === 'open_app' && !b.web_app))) return attachments
  return {
    ...attachments,
    payload: {
      ...attachments.payload,
      buttons: rows.map((row) => row.map((b) => (b.type === 'open_app' && !b.web_app ? { ...b, web_app: username } : b))),
    },
  }
}

async function withOpenAppFallback(
  rawAttachments: InlineKeyboard | null,
  log: Log,
  kind: string,
  send: (attachments: InlineKeyboard | null) => Promise<unknown>,
  max?: MaxClient,
): Promise<void> {
  let attachments = rawAttachments
  if (max?.getBotUsername && withoutOpenApp(rawAttachments)) {
    attachments = withOpenAppWebApp(rawAttachments, await max.getBotUsername().catch(() => null))
  }
  try {
    await send(attachments)
  } catch (error) {
    const safe = error instanceof MaxPermanentError && error.status === 400 ? withoutOpenApp(attachments) : null
    if (!safe) throw error
    log.error('max_open_app_rejected', {
      status: 400,
      kind,
      apiCode: error instanceof MaxPermanentError ? (error.apiCode ?? undefined) : undefined,
      apiMessage: error instanceof MaxPermanentError ? (error.apiMessage ?? undefined) : undefined,
      webApp: attachments !== rawAttachments,
    })
    await send(safe)
  }
}

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
        const callbackId = job.callbackId
        await withOpenAppFallback(job.attachments, log, job.kind, (attachments) =>
          max.answerCallback({ callbackId, text: job.text, attachments, notification: job.notification }),
          max,
        )
      } else {
        try {
          await withOpenAppFallback(job.attachments, log, job.kind, (attachments) =>
            max.sendMessage({ chatId: job.chatId, userId: job.userId, text: job.text ?? '', attachments }),
            max,
          )
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
