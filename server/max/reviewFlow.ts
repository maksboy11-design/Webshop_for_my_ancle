import { randomUUID } from 'node:crypto'
import { buttonLabel, findProduct, productPage } from './catalog'
import { contentHandlers } from './contentRegistry'
import type { InlineKeyboard } from './maxClient'
import type { NewJob, SessionRecord, StoreTx } from './store'
import { authorName, fitMessage, parseCommand, reviewId, reviewText } from './text'
import type { StoredAttachment } from './attachments'
import type { SupportedUpdate } from './update'
import { planExtraCommand, planExtraModeratorCallback } from './webinarFlow'
import type { YoutubeMetadata } from './youtubeImport'

const HELP =
  'Это бот отзывов SILKWAY. Команда /review начинает текстовый отзыв о товаре из каталога. На сайте отзыв появится только после вашего согласия и проверки модератором. /cancel прерывает незавершённый сценарий.'

const MODERATOR_HELP =
  'Меню модератора SILKWAY. Нажмите кнопку или отправьте команду: /reviews_pending — очередь отзывов, /content_pending — прочие сообщения группы, /reviews_published — снять опубликованный отзыв с сайта, /webinars_pending — вебинары на проверке, /webinars_published — снять вебинар с сайта, /review_approve <id> <productId>, /review_reject <id>. Свой отзыв о товаре можно оставить командой /review.'

export interface FlowDeps {
  now: () => Date
  sessionTtlMs: number
  moderators: ReadonlySet<string>
  moderatorsConfigured: boolean
  log: { info(event: string, fields?: { configured?: boolean }): void }
  /** Метаданные YouTube для «Проверить YouTube», получены до транзакции. */
  webinarMetadata?: ReadonlyMap<string, YoutubeMetadata>
}

function expiresAt(deps: FlowDeps): string {
  return new Date(deps.now().getTime() + deps.sessionTtlMs).toISOString()
}

function keyboard(rows: { text: string; payload: string }[][]): InlineKeyboard {
  return {
    type: 'inline_keyboard',
    payload: {
      buttons: rows.map((row) => row.map((button) => ({ type: 'callback' as const, text: button.text, payload: button.payload }))),
    },
  }
}

function isModerator(userId: string, deps: FlowDeps): boolean {
  return deps.moderatorsConfigured && deps.moderators.has(userId)
}

function moderatorMenu(): InlineKeyboard {
  return keyboard([[{ text: 'Очередь отзывов', payload: 'm:q' }], [{ text: 'Все ожидающие сообщения', payload: 'm:c' }],
    [{ text: 'Опубликованные отзывы', payload: 'm:pl:0' }],
    [{ text: 'Вебинары на проверке', payload: 'm:wq:0' }],
    [{ text: 'Опубликованные вебинары', payload: 'm:wl:0' }],
  ])
}

function reviewButtons(id: string): InlineKeyboard {
  return keyboard([[{ text: 'Опубликовать', payload: `m:a:${id}` }, { text: 'Отклонить', payload: `m:r:${id}` }]])
}

function contentButtons(id: string): InlineKeyboard {
  return keyboard([[{ text: 'Отклонить', payload: `m:r:${id}` }]])
}

function pickerKeyboard(id: string, page: number): InlineKeyboard {
  const view = productPage(page)
  const rows = view.items.map((item) => [{ text: buttonLabel(item.name, item.id), payload: `m:p:${id}:${item.id}` }])
  const nav: { text: string; payload: string }[] = []
  if (view.page > 0) nav.push({ text: 'Назад', payload: `m:n:${id}:${view.page - 1}` })
  if (view.page + 1 < view.pageCount) nav.push({ text: 'Дальше', payload: `m:n:${id}:${view.page + 1}` })
  nav.push({ text: 'Отмена', payload: 'm:x' })
  rows.push(nav)
  return keyboard(rows)
}

function cancelRow(): { text: string; payload: string }[] {
  return [{ text: 'Отмена', payload: 'cancel' }]
}

function productKeyboard(page: number): InlineKeyboard {
  const view = productPage(page)
  const rows = view.items.map((item) => [{ text: buttonLabel(item.name, item.id), payload: `p:${item.id}` }])
  const nav: { text: string; payload: string }[] = []
  if (view.page > 0) nav.push({ text: 'Назад', payload: `n:${view.page - 1}` })
  if (view.page + 1 < view.pageCount) nav.push({ text: 'Дальше', payload: `n:${view.page + 1}` })
  nav.push({ text: 'Отмена', payload: 'cancel' })
  rows.push(nav)
  return keyboard(rows)
}

function nameKeyboard(): InlineKeyboard {
  return keyboard([[{ text: 'Не указывать имя', payload: 'skip' }], cancelRow()])
}

function consentKeyboard(): InlineKeyboard {
  return keyboard([
    [{ text: 'Согласен на публикацию', payload: 'yes' }],
    [{ text: 'Не публиковать', payload: 'no' }],
    cancelRow(),
  ])
}

function job(
  update: { chatId: string | null; userId: string },
  text: string,
  attachments: InlineKeyboard | null = null,
  callbackId: string | null = null,
): NewJob {
  return {
    kind: callbackId ? 'callback_answer' : 'message',
    chatId: update.chatId,
    userId: update.userId,
    callbackId,
    text: fitMessage(text),
    attachments,
    notification: callbackId ? 'Принято' : null,
  }
}

function targetOf(update: SupportedUpdate): { chatId: string | null; userId: string; callbackId: string | null } {
  if (update.type === 'message_callback') return { chatId: update.chatId, userId: update.userId, callbackId: update.callbackId }
  if (update.type === 'bot_started') return { chatId: update.chatId, userId: update.userId, callbackId: null }
  return { chatId: update.chatId, userId: update.userId, callbackId: null }
}

async function startChoice(update: SupportedUpdate, tx: StoreTx, deps: FlowDeps): Promise<NewJob[]> {
  const target = targetOf(update)
  await tx.putSession(
    update.userId,
    { step: 'choose_product', productId: null, draftText: null, authorName: null, expiresAt: expiresAt(deps) },
    deps.now().toISOString(),
  )
  return [job(target, 'Выберите товар кнопкой. Черновик можно отменить кнопкой «Отмена» или командой /cancel.', productKeyboard(0))]
}

async function rememberProduct(update: SupportedUpdate, tx: StoreTx, deps: FlowDeps, productId: string): Promise<NewJob[]> {
  const target = targetOf(update)
  await tx.putSession(
    update.userId,
    { step: 'enter_text', productId, draftText: null, authorName: null, expiresAt: expiresAt(deps) },
    deps.now().toISOString(),
  )
  return [job(target, 'Напишите текст отзыва одним сообщением, без вложений. Не больше 2000 символов.', keyboard([cancelRow()]))]
}

async function askConsent(update: SupportedUpdate, tx: StoreTx, deps: FlowDeps, session: SessionRecord, author: string | null): Promise<NewJob[]> {
  const target = targetOf(update)
  await tx.putSession(
    update.userId,
    { ...session, step: 'consent', authorName: author, expiresAt: expiresAt(deps) },
    deps.now().toISOString(),
  )
  return [
    job(
      target,
      'Текст может быть опубликован на сайте SILKWAY после проверки модератором. Без согласия он не сохраняется и не публикуется. Разрешить такую публикацию?',
      consentKeyboard(),
    ),
  ]
}

function assertReviewPolicy(): void {
  if (contentHandlers.review.publication !== 'explicit-consent-and-moderator') throw new Error('unsupported_publication_policy')
  if (contentHandlers.review.permission !== 'dialog-participant') throw new Error('unsupported_permission')
  if (contentHandlers.review.acceptsAttachments) throw new Error('unsupported_attachments')
}

async function planCommand(
  update: Extract<SupportedUpdate, { type: 'message_created' }>,
  tx: StoreTx,
  deps: FlowDeps,
  name: string,
  arg: string | null,
): Promise<NewJob[]> {
  const target = targetOf(update)
  if (name === '/cancel') {
    await tx.deleteSession(update.userId)
    return [job(target, 'Сценарий отменён. Черновик удалён и не будет опубликован.')]
  }
  if (name === '/whoami' || name === '/moderator_id') {
    if (update.chatType !== 'dialog') return [job(target, 'Эта команда работает только в личных сообщениях с ботом.')]
    return [
      job(
        target,
        `Ваш MAX user_id: ${update.userId}. Чтобы стать модератором, владелец сайта добавляет этот номер в переменную MAX_REVIEW_MODERATOR_IDS в Vercel (несколько номеров через запятую) и запускает новый деплой.`,
      ),
    ]
  }
  if (name === '/start' || name === '/help') {
    if (name === '/start') await tx.deleteSession(update.userId)
    return isModerator(update.userId, deps) ? [job(target, MODERATOR_HELP, moderatorMenu())] : [job(target, HELP)]
  }
  if (name === '/menu' || name === '/moderate') {
    if (!isModerator(update.userId, deps)) {
      deps.log.info('moderation_denied', { configured: deps.moderatorsConfigured })
      return [job(target, 'Команда недоступна.')]
    }
    return [job(target, MODERATOR_HELP, moderatorMenu())]
  }
  if (name === '/review') return startChoice(update, tx, deps)
  if (name === '/reviews_published' || name === '/webinars_pending' || name === '/webinars_published') {
    if (!isModerator(update.userId, deps)) deps.log.info('moderation_denied', { configured: deps.moderatorsConfigured })
    return planExtraCommand(name, { ...target, callbackId: null }, tx, deps)
  }
  if (name === '/reviews_pending' || name === '/content_pending' || name === '/review_approve' || name === '/review_reject') {
    return moderate(update, tx, deps, name, arg)
  }
  if (isModerator(update.userId, deps)) return [job(target, `Такая команда не поддерживается. ${MODERATOR_HELP}`, moderatorMenu())]
  return [job(target, 'Такая команда не поддерживается. Доступны /start, /review и /cancel.')]
}

function attachmentSummary(items: readonly StoredAttachment[]): string {
  const images = items.filter((item) => item.type === 'image').length
  const videos = items.filter((item) => item.type === 'video').length
  const other = items.filter((item) => item.type === 'unsupported').length
  if (images + videos + other === 0) return 'нет'
  return `image ${images}, video ${videos}, other ${other}`
}

function commandTarget(arg: string | null): { id: string | null; productId: string | null } {
  if (!arg) return { id: null, productId: null }
  const [head, productId] = arg.trim().split(/\s+/)
  return { id: reviewId(head ?? null), productId: productId ?? null }
}

type JobTarget = { chatId: string | null; userId: string; callbackId: string | null }

async function contentJobs(target: JobTarget, tx: StoreTx): Promise<NewJob[]> {
  const other = await tx.listPendingGroup(5, 'other')
  if (other.length === 0) return [job(target, 'Нет прочего контента группы, ожидающего просмотра.')]
  return [
    ...other.map((row) =>
      job(
        target,
        [
          'Группа, не отзыв (не публикуется)',
          `id: ${row.id}`,
          `тип: ${row.kind}`,
          `вложения: ${attachmentSummary(row.attachments)}`,
          'текст:',
          Array.from(row.publicText ?? 'нет текста').slice(0, 300).join(''),
        ].join('\n'),
        contentButtons(row.id),
      ),
    ),
    job(target, 'Для публикации сообщение должно начинаться со слова «Отзыв» (допустимы эмодзи и знаки перед ним).'),
  ]
}

async function pendingReviewJobs(target: JobTarget, tx: StoreTx): Promise<NewJob[]> {
  const group = await tx.listPendingGroup(3)
  const rows = await tx.listPending(3)
  if (group.length === 0 && rows.length === 0) return [job(target, 'Нет отзывов, ожидающих решения.')]
  const jobs = group.map((row) =>
    job(
      target,
      [
        'Группа, ожидает решения',
        `id: ${row.id}`,
        `чат: ${row.chatId}`,
        `вложения: ${attachmentSummary(row.attachments)}`,
        'текст:',
        row.publicText ?? 'нет текста',
      ].join('\n'),
      reviewButtons(row.id),
    ),
  )
  jobs.push(
    ...rows.map((row) => {
      const product = findProduct(row.productId)
      return job(
        target,
        ['Ожидает решения', `id: ${row.id}`, `товар: ${product?.name ?? row.productId}`, `имя: ${row.author ?? 'не указано'}`, 'текст:', row.text].join('\n'),
        reviewButtons(row.id),
      )
    }),
  )
  const total = (await tx.countPending()) + group.length
  if (total > jobs.length) jobs.push(job(target, 'Показаны первые записи. После решения повторите /reviews_pending.'))
  return jobs
}

async function rejectText(tx: StoreTx, id: string, userId: string, nowIso: string): Promise<string> {
  const dialog = await tx.decide(id, 'rejected', userId, nowIso)
  if (dialog === 'updated') return 'Отзыв отклонён и не будет опубликован.'
  if (dialog === 'not_pending') return 'Отзыв не найден или уже рассмотрен.'
  const group = await tx.rejectGroup(id)
  if (group === 'rejected') return 'Отзыв отклонён и не будет опубликован.'
  return 'Отзыв не найден или уже рассмотрен.'
}

/** Кнопки модератора: payload m:q, m:c, m:x, m:a:<id>, m:r:<id>, m:n:<id>:<page>, m:p:<id>:<productId>. */
async function planModeratorCallback(update: Extract<SupportedUpdate, { type: 'message_callback' }>, tx: StoreTx, deps: FlowDeps): Promise<NewJob[]> {
  const target = targetOf(update)
  const answer = (text: string, attachments: InlineKeyboard | null = null) => [job(target, text, attachments, update.callbackId)]
  if (!isModerator(update.userId, deps) || update.chatType === 'chat' || update.chatType === 'channel') {
    deps.log.info('moderation_denied', { configured: deps.moderatorsConfigured })
    return answer('Команда недоступна.')
  }
  const parts = update.payload.split(':')
  const action = parts[1] ?? ''
  const nowIso = deps.now().toISOString()
  const quiet: NewJob = { kind: 'callback_answer', chatId: target.chatId, userId: target.userId, callbackId: update.callbackId, text: null, attachments: null, notification: 'Принято' }
  const extra = await planExtraModeratorCallback(parts, { ...target, callbackId: update.callbackId }, tx, deps)
  if (extra) return extra
  if (parts.length === 2 && action === 'q') return [quiet, ...(await pendingReviewJobs(target, tx))]
  if (parts.length === 2 && action === 'c') return [quiet, ...(await contentJobs(target, tx))]
  if (parts.length === 2 && action === 'x') return answer('Отменено. Откройте /reviews_pending или /menu.')
  const id = reviewId(parts[2] ?? null)
  if (!id) return answer('Некорректный идентификатор.')
  if (parts.length === 3 && action === 'r') return answer(await rejectText(tx, id, update.userId, nowIso))
  if (parts.length === 3 && action === 'a') {
    const dialog = await tx.decide(id, 'published', update.userId, nowIso)
    if (dialog === 'updated') return answer('Отзыв опубликован на сайте.')
    if (dialog === 'not_pending') return answer('Отзыв не найден или уже рассмотрен.')
    const pendingGroup = await tx.listPendingGroup(200)
    if (pendingGroup.some((item) => item.id === id)) {
      return answer(`Выберите товар, к которому относится отзыв. id: ${id}`, pickerKeyboard(id, 0))
    }
    return answer('Отзыв не найден или уже рассмотрен.')
  }
  if (parts.length === 4 && action === 'n') {
    const page = Number(parts[3])
    if (!Number.isInteger(page) || page < 0 || page > 50) return answer('Выберите товар кнопкой.', pickerKeyboard(id, 0))
    return answer(`Выберите товар, к которому относится отзыв. id: ${id}`, pickerKeyboard(id, page))
  }
  if (parts.length === 4 && action === 'p') {
    const productId = parts[3] ?? ''
    if (!findProduct(productId)) return answer('Этот товар не найден в каталоге.', pickerKeyboard(id, 0))
    const published = await tx.publishGroupReview(id, productId, update.userId, nowIso)
    if (published === 'published') return answer('Отзыв опубликован на сайте. Фото и видео из сообщения появятся в карточке, если они уже сохранены.')
    if (published === 'needs_text') return answer('У отзыва нет текста для сайта. Вложение без текста не публикуется.')
    if (published === 'too_long') return answer('Текст длиннее 2000 символов. Публикация остановлена.')
    return answer('Отзыв не найден или уже рассмотрен.')
  }
  return answer('Это действие сейчас не подходит. Откройте /menu.')
}

async function moderate(
  update: Extract<SupportedUpdate, { type: 'message_created' }>,
  tx: StoreTx,
  deps: FlowDeps,
  name: string,
  arg: string | null,
): Promise<NewJob[]> {
  const target = targetOf(update)
  if (!deps.moderatorsConfigured || !deps.moderators.has(update.userId)) {
    deps.log.info('moderation_denied', { configured: deps.moderatorsConfigured })
    return [job(target, 'Команда недоступна.')]
  }
  if (name === '/content_pending') return contentJobs(target, tx)
  if (name === '/reviews_pending') return pendingReviewJobs(target, tx)
  const { id, productId } = commandTarget(arg)
  if (!id) return [job(target, 'Некорректный идентификатор.')]
  if (name === '/review_reject') return [job(target, await rejectText(tx, id, update.userId, deps.now().toISOString()))]
  if (productId) {
    if (!findProduct(productId)) return [job(target, 'Этот товар не найден в каталоге.')]
    const published = await tx.publishGroupReview(id, productId, update.userId, deps.now().toISOString())
    if (published === 'published') {
      return [job(target, 'Отзыв опубликован на сайте. Фото и видео из сообщения появятся в карточке, если они уже сохранены.')]
    }
    if (published === 'needs_text') return [job(target, 'У отзыва нет текста для сайта. Вложение без текста не публикуется.')]
    if (published === 'too_long') return [job(target, 'Текст длиннее 2000 символов. Публикация остановлена.')]
    if (published === 'not_pending') return [job(target, 'Отзыв не найден или уже рассмотрен.')]
  }
  const result = await tx.decide(id, 'published', update.userId, deps.now().toISOString())
  if (result === 'updated') return [job(target, 'Отзыв опубликован на сайте.')]
  if (result === 'not_pending') return [job(target, 'Отзыв не найден или уже рассмотрен.')]
  const group = await tx.listPendingGroup(20)
  if (group.some((item) => item.id === id)) return [job(target, 'Для отзыва из группы укажите товар: /review_approve <id> <productId>.')]
  return [job(target, 'Отзыв не найден или уже рассмотрен.')]
}

async function planMessage(
  update: Extract<SupportedUpdate, { type: 'message_created' }>,
  tx: StoreTx,
  deps: FlowDeps,
): Promise<NewJob[]> {
  const target = targetOf(update)
  const command = update.text == null ? null : parseCommand(update.text)
  if (command) return planCommand(update, tx, deps, command.name, command.arg)
  if (update.hasAttachments && !contentHandlers.review.acceptsAttachments) {
    return [job(target, 'В этой версии принимается только текст, без вложений. Отправьте отзыв текстом или /cancel.')]
  }
  const found = await tx.getSession(update.userId, deps.now().toISOString())
  if (found.status === 'expired') return [job(target, 'Время сценария вышло. Отправьте /review, чтобы начать заново.')]
  if (found.status === 'none') return [job(target, 'Чтобы отправить отзыв, используйте команду /review.')]
  if (update.text == null) return [job(target, 'Текст отзыва пустой или содержит недопустимые символы. Напишите отзыв словами.')]
  const session = found.session
  if (session.step === 'choose_product') {
    const product = findProduct(update.text.trim())
    if (!product) return [job(target, 'Выберите товар кнопкой из списка.', productKeyboard(0))]
    return rememberProduct(update, tx, deps, product.id)
  }
  if (session.step === 'enter_text') {
    const parsed = reviewText(update.text)
    if (!parsed.ok && parsed.reason === 'too_long') {
      return [job(target, 'Текст длиннее 2000 символов. Сократите отзыв и отправьте ещё раз.')]
    }
    if (!parsed.ok) return [job(target, 'Текст отзыва пустой или содержит недопустимые символы. Напишите отзыв словами.')]
    await tx.putSession(update.userId, { ...session, step: 'enter_name', draftText: parsed.text, expiresAt: expiresAt(deps) }, deps.now().toISOString())
    return [job(target, 'Укажите имя для сайта или нажмите «Не указывать имя». Телефон и адрес не нужны.', nameKeyboard())]
  }
  if (session.step === 'enter_name') {
    const parsed = authorName(update.text)
    if (!parsed.ok && parsed.reason === 'too_long') return [job(target, 'Имя длиннее 80 символов. Сократите его или нажмите «Не указывать имя».', nameKeyboard())]
    if (!parsed.ok) return [job(target, 'Имя пустое. Напишите его или нажмите «Не указывать имя».', nameKeyboard())]
    return askConsent(update, tx, deps, session, parsed.text)
  }
  return [job(target, 'Нужно выбрать «Согласен на публикацию» или «Не публиковать».', consentKeyboard())]
}

async function planCallback(update: Extract<SupportedUpdate, { type: 'message_callback' }>, tx: StoreTx, deps: FlowDeps): Promise<NewJob[]> {
  const target = targetOf(update)
  if (update.payload.startsWith('m:')) return planModeratorCallback(update, tx, deps)
  if (update.payload === 'cancel') {
    await tx.deleteSession(update.userId)
    return [job(target, 'Сценарий отменён. Черновик удалён и не будет опубликован.', null, update.callbackId)]
  }
  const found = await tx.getSession(update.userId, deps.now().toISOString())
  if (found.status !== 'active') {
    const text = found.status === 'expired' ? 'Время сценария вышло. Отправьте /review, чтобы начать заново.' : 'Отправьте /review, чтобы начать.'
    return [job(target, text, null, update.callbackId)]
  }
  const session = found.session
  if (update.payload.startsWith('n:')) {
    if (session.step !== 'choose_product') return [job(target, 'Сначала завершите текущий шаг или отправьте /cancel.', null, update.callbackId)]
    const page = Number(update.payload.slice(2))
    if (!Number.isInteger(page) || page < 0 || page > 50) return [job(target, 'Выберите товар кнопкой.', productKeyboard(0), update.callbackId)]
    return [job(target, 'Выберите товар кнопкой.', productKeyboard(page), update.callbackId)]
  }
  if (update.payload.startsWith('p:')) {
    if (session.step !== 'choose_product') return [job(target, 'Сначала завершите текущий шаг или отправьте /cancel.', null, update.callbackId)]
    const product = findProduct(update.payload.slice(2))
    if (!product) return [job(target, 'Этот товар не найден в каталоге. Выберите товар кнопкой.', productKeyboard(0), update.callbackId)]
    const next = await rememberProduct(update, tx, deps, product.id)
    return next.map((item, index) => (index === 0 ? { ...item, kind: 'callback_answer' as const, callbackId: update.callbackId, notification: 'Принято' } : item))
  }
  if (update.payload === 'skip') {
    if (session.step !== 'enter_name' || !session.draftText || !session.productId) {
      return [job(target, 'Сначала напишите текст отзыва.', null, update.callbackId)]
    }
    const next = await askConsent(update, tx, deps, session, null)
    return next.map((item) => ({ ...item, kind: 'callback_answer' as const, callbackId: update.callbackId, notification: 'Принято' }))
  }
  if (update.payload === 'yes' || update.payload === 'no') {
    if (session.step !== 'consent' || !session.draftText || !session.productId || !findProduct(session.productId)) {
      return [job(target, 'Сценарий устарел. Отправьте /review, чтобы начать заново.', null, update.callbackId)]
    }
    if (update.payload === 'no') {
      await tx.deleteSession(update.userId)
      return [job(target, 'Согласие не получено. Отзыв не сохранён и не будет опубликован.', null, update.callbackId)]
    }
    assertReviewPolicy()
    const nowIso = deps.now().toISOString()
    await tx.insertPending({
      id: randomUUID(),
      productId: session.productId,
      text: session.draftText,
      author: session.authorName,
      receivedAt: nowIso,
      consentAt: nowIso,
      idempotencyKey: update.key,
      senderUserId: update.userId,
    })
    await tx.deleteSession(update.userId)
    return [job(target, 'Отзыв принят на модерацию. На сайте его ещё нет: он появится только после проверки модератором.', null, update.callbackId)]
  }
  return [job(target, 'Это действие сейчас не подходит. Отправьте /review, чтобы начать заново.', null, update.callbackId)]
}

export async function planReviewEvent(update: SupportedUpdate, tx: StoreTx, deps: FlowDeps): Promise<NewJob[]> {
  if (update.type === 'bot_started') {
    await tx.deleteSession(update.userId)
    return isModerator(update.userId, deps) ? [job(update, MODERATOR_HELP, moderatorMenu())] : [job(update, HELP)]
  }
  if (update.type === 'message_created') return planMessage(update, tx, deps)
  if (update.type === 'message_callback') return planCallback(update, tx, deps)
  return []
}
