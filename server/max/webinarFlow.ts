/**
 * Модераторские сценарии: снятие опубликованных отзывов и вебинары (очередь, публикация, снятие).
 * Все действия доступны только модератору в личном диалоге; проверка — в reviewFlow перед вызовом
 * и повторно здесь (assertModerator), чтобы новый вход не обошёл её.
 */
import type { InlineKeyboard } from './maxClient'
import {
  PUBLISHED_REVIEWS_OPEN_TEXT,
  publishedReviewsOpenKeyboard,
  readMiniAppOpenConfig,
  type MiniAppOpenConfig,
} from './miniAppOpen'
import type { NewJob, StoreTx, WebinarRecord } from './store'
import { fitMessage, reviewId } from './text'
import { metadataStatusText, watchUrl, type YoutubeMetadata } from './youtubeImport'

export const LIST_PAGE_SIZE = 5
const MAX_PAGE = 200

export type JobTarget = { chatId: string | null; userId: string; callbackId: string | null }

export interface ModeratorContext {
  moderators: ReadonlySet<string>
  moderatorsConfigured: boolean
  now: () => Date
  /** Свежие метаданные YouTube для «Проверить YouTube», получены до транзакции (по id вебинара). */
  webinarMetadata?: ReadonlyMap<string, YoutubeMetadata>
  /** Кнопка open_app / link для Mini App опубликованных отзывов. */
  miniApp?: MiniAppOpenConfig
}

function buttons(rows: { text: string; payload: string }[][]): InlineKeyboard {
  return {
    type: 'inline_keyboard',
    payload: { buttons: rows.map((row) => row.map((b) => ({ type: 'callback' as const, text: b.text, payload: b.payload }))) },
  }
}

function message(target: JobTarget, text: string, attachments: InlineKeyboard | null = null): NewJob {
  return { kind: 'message', chatId: target.chatId, userId: target.userId, callbackId: null, text: fitMessage(text), attachments, notification: null }
}

function answer(target: JobTarget, text: string, attachments: InlineKeyboard | null = null): NewJob {
  if (!target.callbackId) return message(target, text, attachments)
  return {
    kind: 'callback_answer',
    chatId: target.chatId,
    userId: target.userId,
    callbackId: target.callbackId,
    text: fitMessage(text),
    attachments,
    notification: 'Принято',
  }
}

function quiet(target: JobTarget): NewJob[] {
  if (!target.callbackId) return []
  return [{ kind: 'callback_answer', chatId: target.chatId, userId: target.userId, callbackId: target.callbackId, text: null, attachments: null, notification: 'Принято' }]
}

export function isModeratorUser(userId: string, ctx: ModeratorContext): boolean {
  return ctx.moderatorsConfigured && ctx.moderators.has(userId)
}

function pageOf(raw: string | undefined): number | null {
  if (raw === undefined) return 0
  if (!/^\d{1,3}$/.test(raw)) return null
  const page = Number(raw)
  return page <= MAX_PAGE ? page : null
}

function navRow(prefix: string, page: number, total: number): { text: string; payload: string }[] {
  const nav: { text: string; payload: string }[] = []
  if (page > 0) nav.push({ text: 'Назад', payload: `${prefix}:${page - 1}` })
  if ((page + 1) * LIST_PAGE_SIZE < total) nav.push({ text: 'Дальше', payload: `${prefix}:${page + 1}` })
  return nav
}

/* ---------- Опубликованные отзывы ---------- */

export async function publishedReviewsJobs(
  target: JobTarget,
  _tx: StoreTx,
  _page: number,
  miniApp?: MiniAppOpenConfig,
): Promise<NewJob[]> {
  const cfg = miniApp ?? readMiniAppOpenConfig()
  const keyboard = publishedReviewsOpenKeyboard(cfg)
  const hasOpen = cfg.contactId != null || cfg.publicUrl != null
  const text = hasOpen
    ? PUBLISHED_REVIEWS_OPEN_TEXT
    : [
        PUBLISHED_REVIEWS_OPEN_TEXT,
        '',
        'Мини-приложение ещё не подключено в кабинете MAX.',
        'Задайте MAX_MINI_APP_URL (HTTPS) и MAX_BOT_CONTACT_ID (user_id бота), зарегистрируйте URL в настройках бота (раздел мини-приложения), затем снова откройте /reviews_published.',
      ].join('\n')
  return [...quiet(target), message(target, text, hasOpen ? keyboard : null)]
}

/* ---------- Вебинары ---------- */

function webinarCard(row: WebinarRecord, heading: string): string {
  const titleSource = row.title == null ? 'нет — публикация невозможна' : row.youtubeTitle && row.title === row.youtubeTitle ? `${row.title} (взято из YouTube — проверьте)` : row.title
  const lines = [
    heading,
    `id: ${row.id}`,
    `Название: ${titleSource}`,
    `Спикер: ${row.speaker ?? 'не указан'}`,
    `Дата: ${row.eventDate ?? 'не указана'}`,
  ]
  if (row.sourceType === 'youtube' && row.youtubeVideoId) {
    lines.push(`YouTube: ${watchUrl(row.youtubeVideoId, row.startSeconds)}`)
    if (row.youtubeTitle && row.youtubeTitle !== row.title) lines.push(`Название на YouTube: ${row.youtubeTitle}`)
  } else if (row.recordingSrc) {
    lines.push(`Файл: ${row.recordingSrc}`)
  }
  lines.push(metadataStatusText(row.metadataStatus))
  return lines.join('\n')
}

function pendingWebinarKeyboard(id: string): InlineKeyboard {
  return buttons([
    [
      { text: 'Опубликовать', payload: `m:wa:${id}` },
      { text: 'Отклонить', payload: `m:wr:${id}` },
    ],
    [{ text: 'Проверить YouTube', payload: `m:wm:${id}` }],
  ])
}

/** DM каждому модератору о новом вебинаре. Отправка — через outbox после коммита. */
export function webinarNotificationJobs(row: WebinarRecord, moderators: Iterable<string>, note: string | null = null): NewJob[] {
  const text = fitMessage(`${webinarCard(row, '==НОВЫЙ ВЕБИНАР В ГРУППЕ==')}${note ? `\n${note}` : ''}\nНа сайте его нет, пока модератор не нажмёт «Опубликовать».`)
  const keyboard = pendingWebinarKeyboard(row.id)
  return [...moderators].map((userId): NewJob => ({ kind: 'message', chatId: null, userId, callbackId: null, text, attachments: keyboard, notification: null }))
}

/** DM модераторам: сообщение с маркером «Вебинар», но без корректной YouTube-ссылки, или дубликат. */
export function webinarProblemJobs(text: string, contentId: string | null, moderators: Iterable<string>): NewJob[] {
  const keyboard = contentId ? buttons([[{ text: 'Отклонить', payload: `m:r:${contentId}` }]]) : null
  return [...moderators].map((userId): NewJob => ({ kind: 'message', chatId: null, userId, callbackId: null, text: fitMessage(text), attachments: keyboard, notification: null }))
}

export async function pendingWebinarsJobs(target: JobTarget, tx: StoreTx, page: number): Promise<NewJob[]> {
  const total = await tx.countWebinars('pending')
  const rows = await tx.listWebinars('pending', LIST_PAGE_SIZE, page * LIST_PAGE_SIZE)
  if (rows.length === 0) return [...quiet(target), message(target, page === 0 ? 'Вебинаров на проверке нет.' : 'На этой странице вебинаров нет. Откройте /webinars_pending.')]
  const jobs: NewJob[] = [...quiet(target), ...rows.map((row) => message(target, webinarCard(row, 'Вебинар ждёт решения'), pendingWebinarKeyboard(row.id)))]
  const nav = navRow('m:wq', page, total)
  jobs.push(message(target, `Вебинаров на проверке: ${total}.`, nav.length > 0 ? buttons([nav]) : null))
  return jobs
}

export async function publishedWebinarsJobs(target: JobTarget, tx: StoreTx, page: number): Promise<NewJob[]> {
  const total = await tx.countWebinars('published')
  const rows = await tx.listWebinars('published', LIST_PAGE_SIZE, page * LIST_PAGE_SIZE)
  if (rows.length === 0) return [...quiet(target), message(target, page === 0 ? 'Опубликованных вебинаров нет.' : 'На этой странице вебинаров нет. Откройте /webinars_published.')]
  const jobs: NewJob[] = [
    ...quiet(target),
    ...rows.map((row) => message(target, webinarCard(row, 'Вебинар на сайте'), buttons([[{ text: 'Снять с сайта', payload: `m:ww:${row.id}` }]]))),
  ]
  const nav = navRow('m:wl', page, total)
  jobs.push(message(target, `Опубликованных вебинаров: ${total}. Снятая запись исчезает с сайта, строка в базе остаётся.`, nav.length > 0 ? buttons([nav]) : null))
  return jobs
}

function confirmKeyboard(payload: string): InlineKeyboard {
  return buttons([[{ text: 'Да, снять с сайта', payload }, { text: 'Отмена', payload: 'm:x' }]])
}

const PUBLISH_TEXT: Record<string, string> = {
  published: 'Вебинар опубликован на сайте.',
  missing: 'Вебинар не найден.',
  not_pending: 'Вебинар уже рассмотрен (опубликован, отклонён или снят). Повторное действие не выполнено.',
  needs_title: 'У вебинара нет названия. Добавьте строку «Название: …» в сообщение группы (правка сообщения вернёт его в очередь).',
  blocked_source: 'Источник не прошёл проверку (видео удалено, приватное или ссылка некорректна). Публикация остановлена.',
}

/**
 * Обрабатывает payload m:pl, m:pw, m:pc, m:wq, m:wl, m:wa, m:wr, m:ww, m:wc, m:wm.
 * Возвращает null, если payload не относится к этому модулю.
 */
export async function planExtraModeratorCallback(
  parts: string[],
  target: JobTarget,
  tx: StoreTx,
  ctx: ModeratorContext,
): Promise<NewJob[] | null> {
  const action = parts[1] ?? ''
  if (!['pl', 'pw', 'pc', 'wq', 'wl', 'wa', 'wr', 'ww', 'wc', 'wm'].includes(action)) return null
  if (!isModeratorUser(target.userId, ctx)) return [answer(target, 'Команда недоступна.')]
  if (parts.length > 3) return [answer(target, 'Это действие сейчас не подходит. Откройте /menu.')]
  if (action === 'pl' || action === 'wq' || action === 'wl') {
    const page = pageOf(parts[2])
    if (page == null) return [answer(target, 'Некорректная страница.')]
    if (action === 'pl') return publishedReviewsJobs(target, tx, page, ctx.miniApp)
    if (action === 'wq') return pendingWebinarsJobs(target, tx, page)
    return publishedWebinarsJobs(target, tx, page)
  }
  const id = reviewId(parts[2] ?? null)
  if (!id) return [answer(target, 'Некорректный идентификатор.')]
  const nowIso = ctx.now().toISOString()
  if (action === 'pw') {
    return [answer(target, `Снять отзыв ${id} с сайта? Запись останется в базе, на сайте отзыв перестанет показываться.`, confirmKeyboard(`m:pc:${id}`))]
  }
  if (action === 'pc') {
    const result = await tx.withdrawReview(id, target.userId, nowIso)
    if (result === 'withdrawn') return [answer(target, 'Отзыв снят с сайта. Запись сохранена в базе.')]
    if (result === 'not_published') return [answer(target, 'Отзыв уже снят с сайта или не был опубликован. Повторное действие не выполнено.')]
    return [answer(target, 'Отзыв не найден.')]
  }
  if (action === 'wa') return [answer(target, PUBLISH_TEXT[await tx.publishWebinar(id, target.userId, nowIso)] ?? 'Действие не выполнено.')]
  if (action === 'wr') {
    const result = await tx.rejectWebinar(id, target.userId, nowIso)
    if (result === 'rejected') return [answer(target, 'Вебинар отклонён и не будет опубликован.')]
    if (result === 'not_pending') return [answer(target, PUBLISH_TEXT.not_pending ?? '')]
    return [answer(target, 'Вебинар не найден.')]
  }
  if (action === 'ww') {
    const row = await tx.getWebinar(id)
    if (!row) return [answer(target, 'Вебинар не найден.')]
    if (row.status !== 'published') return [answer(target, 'Вебинар уже снят с сайта или не опубликован.')]
    return [answer(target, `Снять вебинар «${row.title ?? id}» с сайта? Запись останется в базе.`, confirmKeyboard(`m:wc:${id}`))]
  }
  if (action === 'wc') {
    const result = await tx.withdrawWebinar(id, target.userId, nowIso)
    if (result === 'withdrawn') return [answer(target, 'Вебинар снят с сайта. Запись сохранена в базе.')]
    if (result === 'not_published') return [answer(target, 'Вебинар уже снят с сайта или не был опубликован. Повторное действие не выполнено.')]
    return [answer(target, 'Вебинар не найден.')]
  }
  // wm: повторная проверка YouTube (метаданные получены до транзакции).
  const row = await tx.getWebinar(id)
  if (!row) return [answer(target, 'Вебинар не найден.')]
  if (row.status !== 'pending') return [answer(target, PUBLISH_TEXT.not_pending ?? '')]
  if (row.sourceType !== 'youtube') return [answer(target, metadataStatusText(row.metadataStatus))]
  const meta = ctx.webinarMetadata?.get(id)
  if (!meta) return [answer(target, metadataStatusText('api_error'))]
  const titleFromYoutube = row.title == null || row.title === row.youtubeTitle
  const dateFromYoutube = row.eventDate == null || (row.youtubePublishedAt != null && row.eventDate === row.youtubePublishedAt.slice(0, 10))
  const updated: WebinarRecord = {
    ...row,
    title: titleFromYoutube ? (meta.title ?? row.title) : row.title,
    eventDate: dateFromYoutube ? (meta.publishedAt?.slice(0, 10) ?? row.eventDate) : row.eventDate,
    youtubeTitle: meta.title ?? row.youtubeTitle,
    youtubePublishedAt: meta.publishedAt ?? row.youtubePublishedAt,
    metadataStatus: meta.status,
  }
  await tx.updatePendingWebinar(
    id,
    {
      title: updated.title,
      speaker: updated.speaker,
      eventDate: updated.eventDate,
      youtubeTitle: updated.youtubeTitle,
      youtubePublishedAt: updated.youtubePublishedAt,
      metadataStatus: updated.metadataStatus,
    },
    nowIso,
  )
  return [answer(target, webinarCard(updated, 'Проверка YouTube выполнена'), pendingWebinarKeyboard(id))]
}

export type ExtraCommand = '/reviews_published' | '/webinars_pending' | '/webinars_published'

export async function planExtraCommand(name: ExtraCommand, target: JobTarget, tx: StoreTx, ctx: ModeratorContext): Promise<NewJob[]> {
  if (!isModeratorUser(target.userId, ctx)) return [message(target, 'Команда недоступна.')]
  if (name === '/reviews_published') return publishedReviewsJobs(target, tx, 0, ctx.miniApp)
  if (name === '/webinars_pending') return pendingWebinarsJobs(target, tx, 0)
  return publishedWebinarsJobs(target, tx, 0)
}
